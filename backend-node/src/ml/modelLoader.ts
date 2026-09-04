// Attempts to load a trained ONNX prompt-injection model from settings.MODEL_DIR.
//
// No trained artifact ships in this repository — the trained model stays
// uninstalled until explicitly requested (see MIGRATION.md and the project's
// promptguard-pending-hybrid-detector memory) — so in the current real-world
// state this always resolves to `null` and promptClassifierService stays on
// the rule-based fallback, exactly mirroring prompt_classifier_service.py's
// behavior when MODEL_DIR does not contain model files.
//
// The expected artifact is `prompt_injection_pipeline.onnx`: a single fused
// graph produced by converting the trained sklearn
// `Pipeline(TfidfVectorizer, classifier)` with skl2onnx, so it accepts raw
// text and needs no separate vectorizer step on this side (mirrors the
// "full pipeline" artifact Python prefers — see prompt_classifier_service.py's
// artifact-discovery order). An optional `model_metadata.json` alongside it
// (same file Python reads) is loaded for feature-name/threshold metadata.
import fs from 'node:fs'
import path from 'node:path'

// Either name is accepted: `prompt_injection_pipeline.onnx` (the skl2onnx
// "full pipeline" export) or `prompt_injection_model.onnx` (the name used in
// the architecture diagram). First match in this order wins.
const ONNX_PIPELINE_FILENAMES = ['prompt_injection_pipeline.onnx', 'prompt_injection_model.onnx']
const METADATA_FILENAME = 'model_metadata.json'

// onnxruntime-node (a real dependency — see package.json) ships native
// prebuilt binaries per-platform, fetched by its postinstall script; some
// environments (this one included, sandboxed via npm's allow-scripts policy)
// skip postinstall scripts by default, leaving the native binding and its
// bundled .d.ts absent even though the package itself is present. Run
// `npm approve-scripts` (or otherwise allow onnxruntime-node's postinstall)
// to complete the native install before dropping in a real model.
//
// Loaded dynamically through a non-literal specifier and typed as `unknown`
// so: (a) TypeScript never requires its declarations to resolve at build
// time — this file compiles whether or not the postinstall step above has
// run — and (b) a missing/broken native binary on some platform cannot crash
// the whole server at startup; it just leaves the classifier dormant, same
// as an absent model directory.
export async function loadOnnxRuntime(): Promise<Record<string, unknown> | null> {
  const moduleName = 'onnxruntime-node'
  try {
    return (await import(moduleName)) as Record<string, unknown>
  } catch {
    return null
  }
}

export interface LoadedOnnxModel {
  /** An onnxruntime-node `InferenceSession` — kept as `unknown` per the note above. */
  session: unknown
  metadata: Record<string, unknown> | null
}

export async function loadOnnxModel(modelDir: string): Promise<LoadedOnnxModel | null> {
  if (!fs.existsSync(modelDir) || !fs.statSync(modelDir).isDirectory()) {
    return null
  }

  const pipelinePath = ONNX_PIPELINE_FILENAMES.map((name) => path.join(modelDir, name)).find((p) =>
    fs.existsSync(p),
  )
  if (!pipelinePath) {
    return null
  }

  const ort = await loadOnnxRuntime()
  if (!ort) return null

  let session: unknown
  try {
    const InferenceSession = (ort as { InferenceSession: { create: (path: string) => Promise<unknown> } }).InferenceSession
    session = await InferenceSession.create(pipelinePath)
  } catch {
    return null
  }

  let metadata: Record<string, unknown> | null = null
  const metadataPath = path.join(modelDir, METADATA_FILENAME)
  if (fs.existsSync(metadataPath)) {
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as Record<string, unknown>
    } catch {
      metadata = null
    }
  }

  return { session, metadata }
}
