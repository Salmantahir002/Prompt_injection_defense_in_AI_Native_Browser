// Port of backend/app/services/agent_security_service.py.
//
// Scans a page the autonomous agent is about to interact with. Reuses the
// shared detection primitives (chunkingService, promptClassifier) but owns its
// own request lifecycle, aggregation, and event logging — it shares no code
// path with security.routes.ts's analyzeText, so the manual "Scan Page" flow
// cannot be altered by changes made here (and vice versa).
//
// The agent's threat model differs from the manual scanner's: the manual scan
// reports to a human who then decides. This one produces a machine decision
// that halts an autonomous process, so it errs toward blocking and reports
// which content channel carried the threat.
import { settings } from '../config/env.js'
import { promptClassifier, type DetectorSource } from './promptClassifierService.js'
import { chunkingService } from './textChunkingService.js'

/**
 * Stop scanning once this many malicious chunks are found. The agent scan
 * only needs to determine "blocked or allowed" — it doesn't need a complete
 * catalogue of every finding. On a heavily malicious page with 30+ chunks,
 * this avoids dozens of unnecessary DL forward passes.
 */
const MAX_FINDINGS_BEFORE_BAILOUT = 3

/**
 * Number of chunks to classify per incremental batch. Small enough to bail
 * out early without wasting too many forward passes, large enough to benefit
 * from the batched DL inference path.
 */
const INCREMENTAL_BATCH_SIZE = 8

function riskLevel(confidence: number): 'low' | 'medium' | 'high' {
  if (confidence >= 0.85) return 'high'
  if (confidence >= settings.CLASSIFIER_THRESHOLD) return 'medium'
  return 'low'
}

function excerpt(text: string, evidence: readonly string[], width = 200): string {
  const lower = text.toLowerCase()
  const matched = evidence.find((term) => lower.includes(term.toLowerCase())) ?? ''
  if (!matched) return text.slice(0, width) + (text.length > width ? '...' : '')

  const matchIndex = lower.indexOf(matched.toLowerCase())
  const start = Math.max(0, matchIndex - 90)
  const end = Math.min(text.length, start + width)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < text.length ? '...' : ''
  return `${prefix}${text.slice(start, end)}${suffix}`
}

/** Content channels whose presence in a finding is itself evidence of intent. */
const HIDDEN_CHANNELS = new Set(['hidden_text', 'html_comments', 'meta_tags', 'aria_text', 'css_generated_content'])

export interface AgentThreatFinding {
  source: string
  confidence: number
  matched_patterns: string[]
  matched_evidence: string[]
  excerpt: string
  /** Which detector(s) flagged this chunk — 'rule_based', 'dl_model' or 'both'. */
  detector_source: DetectorSource
  /** Prompt Guard's MALICIOUS probability, or null when no model is loaded. */
  malicious_score: number | null
}

export interface AgentScanResult {
  allowed: boolean
  risk_level: 'low' | 'medium' | 'high'
  confidence: number
  summary_reason: string
  matched_patterns: string[]
  blocked_sources: string[]
  findings: AgentThreatFinding[]
  scanned_chunks: number
  classifier_mode: string
  model_precision: string
}

class AgentSecurityService {
  /**
   * Classify each content channel independently. Channels are kept separate
   * rather than concatenated so a hit in, say, html_comments is not reported
   * as visible page text — the agent needs to know an injection was hidden,
   * since that is far stronger evidence of hostility than the same words in a
   * visible paragraph.
   *
   * Chunks are classified in incremental batches rather than all-at-once.
   * Once enough malicious findings are collected, remaining chunks are
   * skipped — the agent's decision is already "blocked" and scanning more
   * only wastes CPU on DL inference.
   */
  async scanSources(sources: ReadonlyArray<readonly [string, string]>): Promise<AgentScanResult> {
    const chunkSize = settings.DEFAULT_CHUNK_SIZE
    const overlap = settings.DEFAULT_CHUNK_OVERLAP

    const findings: AgentThreatFinding[] = []
    const aggregatedPatterns: string[] = []

    // Chunk every channel first.
    const chunks: Array<{ source: string; text: string }> = []
    for (const [sourceName, sourceText] of sources) {
      if (!sourceText || !sourceText.trim()) continue
      for (const chunk of chunkingService.chunkText(sourceText, chunkSize, overlap)) {
        chunks.push({ source: sourceName, text: chunk.text })
      }
    }

    const scannedChunks = chunks.length

    // ── Incremental classification with early exit ──────────────────────
    // Classify in small batches. Once MAX_FINDINGS_BEFORE_BAILOUT malicious
    // chunks are found, stop — the page is already blocked.
    let classifiedCount = 0
    for (let offset = 0; offset < chunks.length; offset += INCREMENTAL_BATCH_SIZE) {
      const batchChunks = chunks.slice(offset, offset + INCREMENTAL_BATCH_SIZE)
      const batchTexts = batchChunks.map((chunk) => chunk.text)
      const results = await promptClassifier.classifyMany(batchTexts)

      for (const [batchIndex, result] of results.entries()) {
        classifiedCount++
        if (!result.is_malicious) continue

        const chunk = batchChunks[batchIndex]!
        const evidence = [...new Set(Object.values(result.pattern_evidence).flat())].sort()
        for (const pattern of result.matched_patterns) {
          if (!aggregatedPatterns.includes(pattern)) aggregatedPatterns.push(pattern)
        }

        findings.push({
          source: chunk.source,
          confidence: result.confidence,
          matched_patterns: [...result.matched_patterns],
          matched_evidence: evidence,
          excerpt: excerpt(chunk.text, evidence),
          detector_source: result.detector_source,
          malicious_score: result.dl.available ? result.dl.malicious_score : null,
        })
      }

      // Early exit: enough evidence to block — skip remaining chunks.
      if (findings.length >= MAX_FINDINGS_BEFORE_BAILOUT) break
    }

    const allowed = findings.length === 0
    const confidence = findings.length > 0 ? Math.max(...findings.map((f) => f.confidence)) : 0.0
    const blockedSources = [...new Set(findings.map((f) => f.source))].sort()

    let summary: string
    if (allowed) {
      summary = 'No prompt injection indicators found in any captured page channel.'
    } else {
      const hiddenChannels = blockedSources.filter((source) => HIDDEN_CHANNELS.has(source))
      const emphasis = hiddenChannels.length > 0
        ? ' The content was hidden from a human reader, which is characteristic of a deliberate attack.'
        : ''
      summary =
        `Indirect prompt injection detected in ${findings.length} chunk(s) across ` +
        `${blockedSources.join(', ')}: ${[...aggregatedPatterns].sort().join(', ')}.${emphasis}`
    }

    return {
      allowed,
      risk_level: allowed ? 'low' : riskLevel(confidence),
      confidence: allowed ? 0.0 : confidence,
      summary_reason: summary,
      matched_patterns: [...aggregatedPatterns].sort(),
      blocked_sources: blockedSources,
      findings,
      scanned_chunks: scannedChunks,
      classifier_mode: promptClassifier.classifierMode,
      model_precision: promptClassifier.modelPrecision,
    }
  }
}

export const agentSecurityService = new AgentSecurityService()
