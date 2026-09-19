// Loads Llama Prompt Guard 2 (22M) — a DeBERTa-v3-xsmall binary sequence classifier
// (BENIGN/MALICIOUS) — from settings.MODEL_DIR via @huggingface/transformers,
// which runs the ONNX graph on onnxruntime-node.
//
// This replaced a generic "any sklearn pipeline exported through skl2onnx"
// loader. That abstraction is gone on purpose: a security-critical classifier
// with two loading paths has one path nobody tests, so this loader knows
// exactly one model shape and fails loudly when it doesn't find it.
//
// Artifact layout expected under MODEL_DIR (transformers.js convention —
// weights live in an onnx/ subfolder, not at the model root):
//
//   <MODEL_DIR>/onnx/model.onnx        fp32, unquantized (see SOURCE.md)
//   <MODEL_DIR>/config.json            id2label, architecture
//   <MODEL_DIR>/tokenizer.json         DeBERTa-v2 SentencePiece fast tokenizer
//   <MODEL_DIR>/tokenizer_config.json
//   <MODEL_DIR>/special_tokens_map.json
import path from 'node:path'
import { pipeline, env } from '@huggingface/transformers'
import { settings } from '../config/env.js'
import { logger } from '../core/logging.js'

// Never phone home: this is a local, fail-closed security control, and a
// silent network fetch of model weights at scan time is not acceptable here.
env.allowRemoteModels = false
env.localModelPath = path.dirname(path.resolve(settings.MODEL_DIR))

const MODEL_NAME = path.basename(settings.MODEL_DIR)

/** Prompt Guard 2's context window. See config.json: max_position_embeddings. */
export const DL_MAX_TOKENS = 512

/** Minimal surface of the transformers.js text-classification pipeline we use. */
export interface DlPipeline {
  (texts: string[], options: { top_k: number }): Promise<Array<Array<{ label: string; score: number }>>>
  tokenizer: { encode(text: string): number[]; model_max_length: number }
}

// Cached on globalThis rather than in a module-level binding. The fp32 graph is
// ~271 MB of resident memory, and anything that evaluates this module twice in
// one process — Vitest's per-file module isolation, a dual ESM/CJS resolution —
// would otherwise allocate a second copy and exhaust the heap.
const CACHE_KEY = Symbol.for('promptguard.dlClassifier')
type LoaderCache = { [CACHE_KEY]?: Promise<DlPipeline | null> | null }
const cache = globalThis as LoaderCache

/**
 * Resolves to the loaded pipeline, or to `null` if the model could not be
 * loaded (missing/corrupt files, no onnxruntime-node native binary for this
 * platform, out of memory). It never rejects: a load failure degrades the
 * service to rule-based-only, which is a visible, documented downgrade
 * (`classifier_mode: "rule_based_fallback"` on /health) rather than a crash.
 *
 * Loads once per process — the fp32 graph is ~271 MB and takes a moment to
 * initialise, so reloading per request would be untenable on the agent loop.
 */
export function loadDlClassifier(): Promise<DlPipeline | null> {
  if (!cache[CACHE_KEY]) {
    cache[CACHE_KEY] = buildPipeline()
  }
  return cache[CACHE_KEY]
}

async function buildPipeline(): Promise<DlPipeline | null> {
  const startedAt = Date.now()
  try {
    const classifier = (await pipeline('text-classification', MODEL_NAME, {
      local_files_only: true,
      // Explicit: this is what resolves onnx/model.onnx rather than a
      // quantized variant. Accuracy is preferred over graph size here.
      dtype: 'fp32',
    })) as unknown as DlPipeline

    // tokenizer_config.json ships model_max_length: 1e30, so the pipeline's
    // own `truncation: true` would never actually truncate and a long chunk
    // would be fed to the model far outside its 512-position training range.
    // Pin it to the real window as a backstop; onnxClassifier splits to this
    // budget up front so truncation should never be reached.
    classifier.tokenizer.model_max_length = DL_MAX_TOKENS

    logger.info(
      { model: MODEL_NAME, dir: path.resolve(settings.MODEL_DIR), precision: 'fp32', load_ms: Date.now() - startedAt },
      'Deep-learning prompt-injection classifier loaded (Llama Prompt Guard 2, fp32).',
    )
    return classifier
  } catch (error) {
    logger.error(
      { err: error, dir: path.resolve(settings.MODEL_DIR), model: MODEL_NAME },
      'Deep-learning classifier failed to load — falling back to rule-based detection only. ' +
        'Prompt injections that rely on rewording or adversarial Unicode may not be caught.',
    )
    return null
  }
}

/** Test-only: forget the cached pipeline so a later load sees a changed MODEL_DIR. */
export function resetDlClassifierForTests(): void {
  cache[CACHE_KEY] = null
}
