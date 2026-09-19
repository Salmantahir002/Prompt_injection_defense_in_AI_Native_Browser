import { settings } from '../config/env.js'
import { classifyChunksDl } from '../dl/onnxClassifier.js'
import { loadDlClassifier } from '../dl/modelLoader.js'
import { logger } from '../core/logging.js'
import { ruleBasedDetector, type DetectResult } from './ruleBasedDetectorService.js'

export type ClassifierMode = 'dl_model' | 'rule_based_fallback'

/** Which detector(s) flagged a chunk. `none` when nothing fired. */
export type DetectorSource = 'none' | 'rule_based' | 'dl_model' | 'both'

/**
 * Pattern name reported when only the DL detector fires. The rule engine names
 * the category it matched; a transformer has no keyword evidence to name, but
 * `matched_patterns` is the field the explainability drawer and the agent's
 * threat modal read, so a DL-only detection must still put something there
 * rather than blocking a page with a blank reason.
 */
export const DL_DETECTION_PATTERN = 'deep_learning_detection'

export interface RuleBasedVerdict {
  matched: boolean
  confidence: number
  matched_patterns: string[]
}

export type DlChunkVerdict =
  | { available: true; matched: boolean; malicious_score: number }
  /** Model not loaded at all — the documented rule-based-only degradation. */
  | { available: false }
  /** Model loaded but inference threw for this request: fail closed, don't call it benign. */
  | { available: true; matched: true; malicious_score: number; error: string }

export interface ClassifyResult extends DetectResult {
  classifier_mode: ClassifierMode
  rule_based: RuleBasedVerdict
  dl: DlChunkVerdict
  detector_source: DetectorSource
}

/**
 * Layered classifier: every chunk is scored by the rule-based detector *and*
 * by the deep-learning detector, and a chunk is malicious if either one fires.
 *
 * These two are complementary, not redundant. The rule engine cannot catch
 * heavily re-worded attacks or adversarial Unicode — exactly what Prompt Guard
 * generalises over — while the rule engine returns the matched keywords and
 * categories the explainability drawer renders, which a bare transformer score
 * cannot provide. For a control whose premise is "do not miss the injection",
 * running one and not the other is strictly worse than running both.
 */
class PromptClassifierService {
  private _modelLoaded = false
  private readonly _ready: Promise<void>

  constructor() {
    this._ready = this.loadModel()
  }

  private async loadModel(): Promise<void> {
    // loadDlClassifier never rejects; a failed load resolves to null and the
    // service stays in rule_based_fallback. See dl/modelLoader.ts.
    this._modelLoaded = (await loadDlClassifier()) !== null
  }

  /** Await before asserting on modelLoaded/classifierMode. */
  async ready(): Promise<void> {
    return this._ready
  }

  get modelLoaded(): boolean {
    return this._modelLoaded
  }

  get classifierMode(): ClassifierMode {
    return this._modelLoaded ? 'dl_model' : 'rule_based_fallback'
  }

  /** fp32 (unquantized) whenever the DL model is active — see dl_models/.../SOURCE.md. */
  get modelPrecision(): 'fp32' | 'none' {
    return this._modelLoaded ? 'fp32' : 'none'
  }

  async classify(text: string): Promise<ClassifyResult> {
    const [result] = await this.classifyMany([text])
    // classifyMany returns exactly one result per input.
    return result as ClassifyResult
  }

  /**
   * Classifies many chunks in one call. Callers that already hold a full chunk
   * list should use this rather than looping over `classify`: the DL detector
   * runs the whole set as batched forward passes, which is materially faster
   * on CPU than N sequential ones — and this runs on every agent iteration.
   */
  async classifyMany(texts: readonly string[]): Promise<ClassifyResult[]> {
    await this._ready

    const ruleResults = texts.map((text) => ruleBasedDetector.detect(text))

    let dlVerdicts: Array<DlChunkVerdict> | null = null
    if (this._modelLoaded && texts.length > 0) {
      try {
        const verdicts = await classifyChunksDl(texts)
        dlVerdicts =
          verdicts?.map((verdict) => ({
            available: true as const,
            matched: verdict.maliciousScore >= settings.DL_MALICIOUS_THRESHOLD,
            malicious_score: verdict.maliciousScore,
          })) ?? null
      } catch (error) {
        // Fail closed. The model loaded successfully at startup, so a failure
        // now is an anomaly, not a known degradation — treating the chunk as
        // benign would turn an error into a bypass. Flagged distinctly from a
        // genuine malicious verdict via the `error` field so the two are
        // never confused when reading events or logs.
        const message = error instanceof Error ? error.message : String(error)
        logger.error({ err: error, chunk_count: texts.length }, 'DL classifier inference failed — failing closed.')
        dlVerdicts = texts.map(() => ({ available: true as const, matched: true as const, malicious_score: 1, error: message }))
      }
    }

    return ruleResults.map((ruleResult, index) => {
      const dl: DlChunkVerdict = dlVerdicts?.[index] ?? { available: false }
      const dlMatched = dl.available && dl.matched
      const isMalicious = ruleResult.is_malicious || dlMatched

      let detectorSource: DetectorSource = 'none'
      if (ruleResult.is_malicious && dlMatched) detectorSource = 'both'
      else if (ruleResult.is_malicious) detectorSource = 'rule_based'
      else if (dlMatched) detectorSource = 'dl_model'

      return {
        // The reported confidence is the stronger of the two signals, so a
        // rewording the rule engine misses still surfaces at its true severity.
        is_malicious: isMalicious,
        confidence: isMalicious
          ? Math.max(ruleResult.confidence, dl.available && dl.matched ? dl.malicious_score : 0)
          : 0,
        matched_patterns: dlMatched && !ruleResult.is_malicious
          ? [DL_DETECTION_PATTERN]
          : ruleResult.matched_patterns,
        pattern_evidence: ruleResult.pattern_evidence,
        classifier_mode: this.classifierMode,
        rule_based: {
          matched: ruleResult.is_malicious,
          confidence: ruleResult.confidence,
          matched_patterns: ruleResult.matched_patterns,
        },
        dl,
        detector_source: detectorSource,
      }
    })
  }
}

export const promptClassifier = new PromptClassifierService()
