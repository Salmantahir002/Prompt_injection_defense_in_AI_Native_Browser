export type ClassifierMode = 'dl_model' | 'rule_based_fallback'
export type DetectorSource = 'none' | 'rule_based' | 'dl_model' | 'both'

export type RuleBasedVerdict = {
  matched: boolean
  confidence: number
  matched_patterns: string[]
}

// `available: false` when no DL model is loaded; `error` is set when the model
// loaded but inference failed for this chunk, which the backend fails closed on.
export type DlVerdict =
  | { available: true; matched: boolean; malicious_score: number; error?: string }
  | { available: false }
export type SecurityLabel = 'benign' | 'malicious'
export type RiskLevel = 'low' | 'medium' | 'high'

export type PreprocessingSummary = {
  original_length: number
  normalized_length: number
  token_count: number
  steps_applied: string[]
}

export type ChunkingInfo = {
  chunk_count: number
  chunk_size: number
  overlap: number
  highest_risk_chunk_id: string
}

export type FeatureEvidence = {
  top_terms: string[]
  instruction_density: number
  role_override_count: number
  data_exfiltration_count: number
  semantic_similarity_to_malicious_patterns: number
  embedding_or_vectorizer_used: string
}

export type ChunkResult = {
  chunk_id: string
  source: string
  label: SecurityLabel
  confidence: number
  risk_level: RiskLevel
  matched_patterns: string[]
  reason: string
  excerpt: string
  matched_evidence: string[]
  detector_source: DetectorSource
  rule_based: RuleBasedVerdict
  dl: DlVerdict
}

export type AnalysisDetails = {
  classifier_mode: ClassifierMode
  model_precision: 'fp32' | 'none'
  threshold_used: number
  preprocessing: PreprocessingSummary
  chunking: ChunkingInfo
  feature_evidence: FeatureEvidence
  chunk_results: ChunkResult[]
  final_rationale: string
}
