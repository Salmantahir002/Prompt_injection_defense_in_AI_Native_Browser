# Model source

| | |
|---|---|
| Hugging Face repo | [`gravitee-io/Llama-Prompt-Guard-2-22M-onnx`](https://huggingface.co/gravitee-io/Llama-Prompt-Guard-2-22M-onnx) |
| Upstream model | `meta-llama/Llama-Prompt-Guard-2-22M` |
| Architecture | `DebertaV2ForSequenceClassification` (DeBERTa-v3-xsmall backbone, 22M) |
| Labels | `{0: BENIGN, 1: MALICIOUS}` |
| Context window | 512 tokens (`max_position_embeddings`) |
| Languages | English, French, German, Hindi, Italian, Portuguese, Spanish, Thai |

## Files here

```
onnx/model.onnx            fp32, 284,217,797 bytes
                           sha256 c6f4d2ebf59be36f3557ad484bf11a51f1b356f570958d1ec1cbbe322a8dfddf
config.json                id2label / architecture
tokenizer.json             DeBERTa-v2 SentencePiece fast tokenizer (vocab 128,100)
tokenizer_config.json
special_tokens_map.json
```

The repo ships `model.onnx` at its root; `@huggingface/transformers` resolves ONNX
weights from an `onnx/` subfolder of the model directory, so the file is placed
there rather than dropped in as-shipped. The upstream repo has no separate
SentencePiece `.model` file - `tokenizer.json` carries the full vocabulary and
normalizer, which is what the library loads.

## fp32, not quantized - deliberate

The repo also publishes `model.quant.onnx` (int8). It is **not** kept
here. Accuracy is the priority for this detector, and leaving the quantized file
in the directory would invite a future `dtype` default to pick it up silently.
`src/dl/modelLoader.ts` passes `dtype: 'fp32'` explicitly for the same reason,
and `/health` reports `model_precision: "fp32"` so the choice is visible from
outside the process.

Cost of that choice: ~271 MB resident and ~1 s to load at startup, both paid
once per process.

## Not in version control

The weights are past sensible git limits. Re-fetch with:

```bash
mkdir -p onnx
curl -L -o onnx/model.onnx https://huggingface.co/gravitee-io/Llama-Prompt-Guard-2-22M-onnx/resolve/main/model.onnx
for f in config.json tokenizer.json tokenizer_config.json special_tokens_map.json; do
  curl -L -o "$f" "https://huggingface.co/gravitee-io/Llama-Prompt-Guard-2-22M-onnx/resolve/main/$f"
done
```

With this directory absent the backend still boots, in rule-based-only mode
(`classifier_mode: "rule_based_fallback"`). See `test/dl/dlFallback.test.ts`.
