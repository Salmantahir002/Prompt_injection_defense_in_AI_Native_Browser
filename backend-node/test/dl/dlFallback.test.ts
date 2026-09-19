// Phase 7 #4/#6 and Phase 6: the server must boot and keep detecting with the
// DL model unavailable, the two scan paths must stay wired to the same channel
// list, and a mid-request inference failure must fail closed.
import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AGENT_SCAN_CHANNELS } from '../../src/routes/agent.routes.js'
import { MANUAL_SCAN_CHANNELS } from '../../src/routes/security.routes.js'

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

describe('startup with no model present', () => {
  // Run in a child process: MODEL_DIR is read once at import time, and the
  // loaded pipeline is cached per-process, so this cannot be exercised by
  // mutating env inside the shared test process.
  it('boots, reports rule_based_fallback, and still blocks an injection', () => {
    const stdout = execFileSync(
      process.execPath,
      ['--import', 'tsx', path.join(backendRoot, 'test/dl/noModelProbe.ts')],
      {
        cwd: backendRoot,
        encoding: 'utf-8',
        env: { ...process.env, MODEL_DIR: 'dl_models/does_not_exist', APP_ENV: 'test' },
        timeout: 120_000,
      },
    )

    const payload = /__PROBE__(.*)__PROBE__/s.exec(stdout)?.[1]
    expect(payload, `probe produced no result; stdout was:
${stdout}`).toBeTruthy()
    const result = JSON.parse(payload!) as {
      health: { status: string; model_loaded: boolean; classifier_mode: string; model_precision: string }
      injection: {
        allowed: boolean
        matched_patterns: string[]
        analysis_details: { classifier_mode: string; model_precision: string }
      }
      benign: { allowed: boolean }
    }

    expect(result.health.status).toBe('healthy')
    expect(result.health.model_loaded).toBe(false)
    expect(result.health.classifier_mode).toBe('rule_based_fallback')
    expect(result.health.model_precision).toBe('none')

    // Degraded, not open: the rule engine still blocks end-to-end over HTTP.
    expect(result.injection.allowed).toBe(false)
    expect(result.injection.matched_patterns.length).toBeGreaterThan(0)
    expect(result.injection.analysis_details.classifier_mode).toBe('rule_based_fallback')
    expect(result.injection.analysis_details.model_precision).toBe('none')
    expect(result.benign.allowed).toBe(true)
  }, 180_000)
})

describe('scan-path parity', () => {
  it('the agent and manual scans share one channel list, so neither can drift', () => {
    expect(AGENT_SCAN_CHANNELS).toBe(MANUAL_SCAN_CHANNELS)
    expect([...AGENT_SCAN_CHANNELS]).toEqual([...MANUAL_SCAN_CHANNELS])
  })
})

describe('per-request inference failure', () => {
  it('fails closed and is reported distinctly from a genuine malicious verdict', async () => {
    vi.resetModules()
    vi.doMock('../../src/dl/onnxClassifier.js', () => ({
      classifyChunksDl: vi.fn(async () => {
        throw new Error('onnxruntime session crashed mid-request')
      }),
    }))
    vi.doMock('../../src/dl/modelLoader.js', () => ({
      DL_MAX_TOKENS: 512,
      // Pretend the model loaded fine at startup — the point of this test is a
      // failure that happens *after* a successful load, where falling back to
      // "benign" would turn an error into a bypass.
      loadDlClassifier: vi.fn(async () => ({ tokenizer: { encode: () => [], model_max_length: 512 } })),
      resetDlClassifierForTests: vi.fn(),
    }))

    const { promptClassifier } = await import('../../src/services/promptClassifierService.js')
    await promptClassifier.ready()
    expect(promptClassifier.modelLoaded).toBe(true)

    const [result] = await promptClassifier.classifyMany(['What is the capital of France?'])
    expect(result!.is_malicious).toBe(true)
    expect(result!.dl.available).toBe(true)
    // The error field is what separates "the classifier broke" from "the model
    // says this is an attack" when reading events or logs.
    expect(result!.dl.available && result!.dl.error).toContain('crashed mid-request')
    expect(result!.rule_based.matched).toBe(false)

    vi.doUnmock('../../src/dl/onnxClassifier.js')
    vi.doUnmock('../../src/dl/modelLoader.js')
    vi.resetModules()
  })
})
