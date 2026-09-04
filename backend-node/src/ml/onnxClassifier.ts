// Runs text through a loaded ONNX pipeline session and reshapes the output
// into the same contract promptClassifierService already exposes.
//
// ponytail: the exact input/output tensor names and shapes depend on how the
// sklearn `Pipeline(TfidfVectorizer, classifier)` was converted to ONNX
// (skl2onnx typically emits a single string-input graph with a label output
// plus a probability output, sometimes wrapped in a ZipMap). Since no .onnx
// artifact exists in this repo yet — the trained model stays uninstalled
// until asked, see modelLoader.ts — this reads the session's own declared
// input/output names rather than hardcoding guessed ones, and any output
// shape it doesn't recognize throws, which the caller (promptClassifierService)
// catches and falls back to the rule-based detector — the same broad
// try/except fallback prompt_classifier_service.py's `_classify_with_model` uses.
import { ruleBasedDetector } from '../services/ruleBasedDetectorService.js'
import { loadOnnxRuntime, type LoadedOnnxModel } from './modelLoader.js'

export interface OnnxClassifyResult {
  is_malicious: boolean
  confidence: number
  matched_patterns: string[]
  pattern_evidence: Record<string, string[]>
}

interface OnnxSession {
  inputNames: string[]
  outputNames: string[]
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number> }>>
}

export async function classifyWithOnnx(model: LoadedOnnxModel, text: string): Promise<OnnxClassifyResult> {
  const ortModule = await loadOnnxRuntime()
  if (!ortModule) throw new Error('onnxruntime-node is not available.')
  const ort = ortModule as unknown as { Tensor: new (type: string, data: unknown, dims: number[]) => unknown }
  const session = model.session as OnnxSession

  const inputName = session.inputNames[0]
  if (!inputName) throw new Error('ONNX session declares no inputs.')

  const feeds: Record<string, unknown> = { [inputName]: new ort.Tensor('string', [text], [1]) }
  const outputMap = await session.run(feeds)
  const { isMalicious, confidence } = interpretOutput(outputMap, session.outputNames)

  // The ML model makes the block/allow decision; the rule-based detector runs
  // alongside it purely to supply matched_patterns/pattern_evidence, since the
  // ONNX pipeline itself only emits a probability — no per-category evidence —
  // so the explainability drawer still has keyword evidence to show.
  const ruleResult = ruleBasedDetector.detect(text)

  return {
    is_malicious: isMalicious,
    confidence,
    matched_patterns: isMalicious ? [...ruleResult.matched_patterns] : [],
    pattern_evidence: isMalicious ? ruleResult.pattern_evidence : {},
  }
}

function interpretOutput(
  outputMap: Record<string, { data: ArrayLike<number> }>,
  outputNames: string[],
): { isMalicious: boolean; confidence: number } {
  // Most common skl2onnx shape for a binary classifier: a probability tensor
  // with 2 entries, [P(safe), P(malicious)] — the positive-class convention
  // used throughout this codebase's ML metadata.
  for (const name of outputNames) {
    const data = outputMap[name]?.data
    if (data && data.length >= 2) {
      const probMalicious = Number(data[1])
      return { isMalicious: probMalicious >= 0.5, confidence: probMalicious >= 0.5 ? probMalicious : 1 - probMalicious }
    }
  }
  throw new Error('Unrecognized ONNX model output shape.')
}
