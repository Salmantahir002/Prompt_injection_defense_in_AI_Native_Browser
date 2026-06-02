"""
Prompt Classifier Service
=========================
Loads a trained ML model pipeline from the configured model directory.
If no model files are found, falls back to the rule-based detector seamlessly.
"""

import os
import json
import logging
from typing import Any, Dict, List, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


class PromptClassifierService:
    """
    Unified classifier that attempts to load a trained ML model pipeline.
    When a model is unavailable, it delegates to the rule-based fallback detector.
    """

    def __init__(self) -> None:
        self._pipeline: Optional[Any] = None
        self._vectorizer: Optional[Any] = None
        self._metadata: Optional[Dict[str, Any]] = None
        self._model_loaded: bool = False
        self._classifier_mode: str = "rule_based_fallback"
        self._load_model()

    # ─── Model Loading ──────────────────────────────────────────────

    def _load_model(self) -> None:
        """Try to load model artefacts from the configured MODEL_DIR."""
        model_dir = settings.MODEL_DIR

        if not os.path.isdir(model_dir):
            logger.info("Model directory '%s' does not exist — using rule-based fallback.", model_dir)
            return

        # 1) Full pipeline (preferred)
        pipeline_path = os.path.join(model_dir, "prompt_injection_pipeline.joblib")
        if os.path.isfile(pipeline_path):
            try:
                import joblib  # type: ignore[import-untyped]
                self._pipeline = joblib.load(pipeline_path)
                self._model_loaded = True
                self._classifier_mode = "ml_model"
                logger.info("Loaded full ML pipeline from '%s'.", pipeline_path)
            except Exception as exc:
                logger.warning("Failed to load pipeline: %s — falling back to rules.", exc)

        # 2) Separate vectorizer (optional, only useful if pipeline doesn't contain one)
        vectorizer_path = os.path.join(model_dir, "tfidf_vectorizer.joblib")
        if os.path.isfile(vectorizer_path) and not self._model_loaded:
            try:
                import joblib  # type: ignore[import-untyped]
                self._vectorizer = joblib.load(vectorizer_path)
                logger.info("Loaded TF-IDF vectorizer from '%s'.", vectorizer_path)
            except Exception as exc:
                logger.warning("Failed to load vectorizer: %s", exc)

        # 3) Stacking classifier (optional, used with separate vectorizer)
        classifier_path = os.path.join(model_dir, "stacking_classifier.joblib")
        if os.path.isfile(classifier_path) and self._vectorizer is not None and not self._model_loaded:
            try:
                import joblib  # type: ignore[import-untyped]
                self._pipeline = joblib.load(classifier_path)
                self._model_loaded = True
                self._classifier_mode = "ml_model"
                logger.info("Loaded stacking classifier from '%s'.", classifier_path)
            except Exception as exc:
                logger.warning("Failed to load stacking classifier: %s", exc)

        # 4) Metadata
        metadata_path = os.path.join(model_dir, "model_metadata.json")
        if os.path.isfile(metadata_path):
            try:
                with open(metadata_path, "r", encoding="utf-8") as f:
                    self._metadata = json.load(f)
                logger.info("Loaded model metadata from '%s'.", metadata_path)
            except Exception as exc:
                logger.warning("Failed to load model metadata: %s", exc)

        if not self._model_loaded:
            logger.info("No trained model files found — using rule-based fallback.")

    # ─── Public API ─────────────────────────────────────────────────

    @property
    def model_loaded(self) -> bool:
        return self._model_loaded

    @property
    def classifier_mode(self) -> str:
        return self._classifier_mode

    @property
    def metadata(self) -> Optional[Dict[str, Any]]:
        return self._metadata

    def classify(self, text: str) -> Dict[str, Any]:
        """
        Classify text using the loaded ML model.
        Falls back to rule-based detector if no model is loaded.

        Returns dict with keys:
            is_malicious: bool
            confidence: float
            matched_patterns: List[str]
            pattern_evidence: Dict[str, List[str]]
            classifier_mode: str
        """
        if self._model_loaded and self._pipeline is not None:
            return self._classify_with_model(text)

        # Delegate to rule-based fallback
        from app.services.rule_based_detector_service import rule_based_detector
        result = rule_based_detector.detect(text)
        result["classifier_mode"] = "rule_based_fallback"
        return result

    def _classify_with_model(self, text: str) -> Dict[str, Any]:
        """Run text through the loaded ML pipeline."""
        try:
            # If we have a separate vectorizer, transform first
            if self._vectorizer is not None:
                features = self._vectorizer.transform([text])
                prediction = self._pipeline.predict(features)
                probabilities = self._pipeline.predict_proba(features)
            else:
                # Full pipeline handles vectorization internally
                prediction = self._pipeline.predict([text])
                probabilities = self._pipeline.predict_proba([text])

            label_idx = int(prediction[0])
            is_malicious = label_idx == 1
            confidence = float(probabilities[0][label_idx])

            # Extract feature names from metadata if available
            matched_patterns: List[str] = []
            if is_malicious and self._metadata and "feature_names" in self._metadata:
                matched_patterns = ["ml_model_detection"]

            return {
                "is_malicious": is_malicious,
                "confidence": confidence,
                "matched_patterns": matched_patterns,
                "pattern_evidence": {},
                "classifier_mode": "ml_model",
            }
        except Exception as exc:
            logger.error("ML model prediction failed: %s — falling back to rules.", exc)
            from app.services.rule_based_detector_service import rule_based_detector
            result = rule_based_detector.detect(text)
            result["classifier_mode"] = "rule_based_fallback"
            return result


# Singleton
prompt_classifier = PromptClassifierService()
