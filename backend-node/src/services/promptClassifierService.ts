import { settings } from '../config/env.js'
import { loadOnnxModel, type LoadedOnnxModel } from '../ml/modelLoader.js'
import { classifyWithOnnx } from '../ml/onnxClassifier.js'
import { ruleBasedDetector, type DetectResult } from './ruleBasedDetectorService.js'

export type ClassifierMode = 'ml_model' | 'rule_based_fallback'

export interface ClassifyResult extends DetectResult {
  classifier_mode: ClassifierMode
}

/**
 * Unified classifier that loads a trained ONNX model pipeline from
 * settings.MODEL_DIR if one is present (see ml/modelLoader.ts for the exact
 * artifact it looks for). No trained model artifact exists in this repository
 * (mirrors the Python backend's current real-world state, and the project's
 * explicit "leave the model uninstalled until asked" decision) so this stays
 * dormant and every call delegates to the rule-based detector — same fallback
 * behavior as prompt_classifier_service.py when MODEL_DIR is absent.
 */
class PromptClassifierService {
  private _modelLoaded = false
  private _classifierMode: ClassifierMode = 'rule_based_fallback'
  private _model: LoadedOnnxModel | null = null
  private readonly _ready: Promise<void>

  constructor() {
    this._ready = this.loadModel()
  }

  private async loadModel(): Promise<void> {
    try {
      this._model = await loadOnnxModel(settings.MODEL_DIR)
    } catch {
      this._model = null
    }
    if (this._model) {
      this._modelLoaded = true
      this._classifierMode = 'ml_model'
    }
  }

  /** Test-only hook: await before asserting on modelLoaded/classifierMode in a test that drops a model file in first. */
  async ready(): Promise<void> {
    return this._ready
  }

  get modelLoaded(): boolean {
    return this._modelLoaded
  }

  get classifierMode(): ClassifierMode {
    return this._classifierMode
  }

  async classify(text: string): Promise<ClassifyResult> {
    await this._ready

    if (this._modelLoaded && this._model) {
      try {
        const result = await classifyWithOnnx(this._model, text)
        return { ...result, classifier_mode: 'ml_model' }
      } catch {
        // Falls through to the rule-based detector below, exactly like
        // prompt_classifier_service.py's _classify_with_model broad except.
      }
    }

    const result = ruleBasedDetector.detect(text)
    return { ...result, classifier_mode: 'rule_based_fallback' }
  }
}

export const promptClassifier = new PromptClassifierService()
