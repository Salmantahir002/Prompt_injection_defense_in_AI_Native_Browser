import { Type, type Static } from '@sinclair/typebox'

export const PreprocessingSummarySchema = Type.Object({
  original_length: Type.Integer(),
  normalized_length: Type.Integer(),
  token_count: Type.Integer(),
  steps_applied: Type.Array(Type.String()),
})

export const ChunkingInfoSchema = Type.Object({
  chunk_count: Type.Integer(),
  chunk_size: Type.Integer(),
  overlap: Type.Integer(),
  highest_risk_chunk_id: Type.String(),
})

export const FeatureEvidenceSchema = Type.Object({
  top_terms: Type.Array(Type.String()),
  instruction_density: Type.Number(),
  role_override_count: Type.Integer(),
  data_exfiltration_count: Type.Integer(),
  semantic_similarity_to_malicious_patterns: Type.Number(),
  embedding_or_vectorizer_used: Type.String(),
})

export const RuleBasedVerdictSchema = Type.Object({
  matched: Type.Boolean(),
  confidence: Type.Number(),
  matched_patterns: Type.Array(Type.String()),
})

// `available: false` means no model is loaded (rule-based-only degradation).
// `error` is present when the model loaded but inference threw for this chunk,
// which fails closed — kept distinct from a genuine malicious verdict.
export const DlVerdictSchema = Type.Union([
  Type.Object({
    available: Type.Literal(true),
    matched: Type.Boolean(),
    malicious_score: Type.Number(),
    error: Type.Optional(Type.String()),
  }),
  Type.Object({ available: Type.Literal(false) }),
])

export const ChunkResultSchema = Type.Object({
  chunk_id: Type.String(),
  source: Type.String(),
  label: Type.Union([Type.Literal('benign'), Type.Literal('malicious')]),
  confidence: Type.Number(),
  risk_level: Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')]),
  matched_patterns: Type.Array(Type.String()),
  reason: Type.String(),
  excerpt: Type.String(),
  matched_evidence: Type.Array(Type.String()),
  detector_source: Type.Union([
    Type.Literal('none'),
    Type.Literal('rule_based'),
    Type.Literal('dl_model'),
    Type.Literal('both'),
  ]),
  rule_based: RuleBasedVerdictSchema,
  dl: DlVerdictSchema,
})

export const AnalysisDetailsSchema = Type.Object({
  classifier_mode: Type.Union([Type.Literal('dl_model'), Type.Literal('rule_based_fallback')]),
  // Externally visible confirmation that the unquantized graph is in use.
  model_precision: Type.Union([Type.Literal('fp32'), Type.Literal('none')]),
  threshold_used: Type.Number(),
  preprocessing: PreprocessingSummarySchema,
  chunking: ChunkingInfoSchema,
  feature_evidence: FeatureEvidenceSchema,
  chunk_results: Type.Array(ChunkResultSchema),
  final_rationale: Type.String(),
})

export type AnalysisDetails = Static<typeof AnalysisDetailsSchema>
export type ChunkResult = Static<typeof ChunkResultSchema>
