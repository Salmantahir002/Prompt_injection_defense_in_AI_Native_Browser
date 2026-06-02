# Trained Model Placement Directory

This directory is the designated location for placing your trained ML model files.

## How It Works

When the backend starts, `prompt_classifier_service.py` automatically checks this directory for model files:

1. **If model files are found**: The ML pipeline is loaded and used for prompt injection classification.
2. **If model files are missing**: The system automatically falls back to the rule-based detector — no code changes needed.

## Expected Model Files

| File | Required | Description |
|------|----------|-------------|
| `prompt_injection_pipeline.joblib` | **Primary** | Full sklearn pipeline (preprocessing + vectorization + classifier) |
| `tfidf_vectorizer.joblib` | Optional | Separate TF-IDF vectorizer (used if pipeline doesn't include one) |
| `stacking_classifier.joblib` | Optional | Separate classifier (used with separate vectorizer) |
| `model_metadata.json` | Optional | Labels, threshold, version, training metrics, feature names |
| `embedding_model_config.json` | Optional | Embedding model metadata for future deep learning models |

## How to Add Your Trained Model

1. Train your prompt injection classifier using scikit-learn (or compatible framework).
2. Save the pipeline using `joblib.dump(pipeline, "prompt_injection_pipeline.joblib")`.
3. Place the `.joblib` file(s) in this directory.
4. Optionally add `model_metadata.json` with training details.
5. Restart the backend — it will automatically detect and load the model.

## model_metadata.json Example

```json
{
  "model_name": "prompt_injection_stacking_classifier",
  "version": "1.0.0",
  "training_date": "2026-06-01",
  "labels": ["benign", "malicious"],
  "threshold": 0.70,
  "accuracy": 0.95,
  "f1_score": 0.93,
  "feature_names": ["tfidf_features"],
  "training_samples": 10000
}
```
