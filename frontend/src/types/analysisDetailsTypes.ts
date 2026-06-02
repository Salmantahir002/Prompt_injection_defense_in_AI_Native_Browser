export type ClassifierMode = 'ml_model' | 'rule_based_fallback'
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
  label: SecurityLabel
  confidence: number
  risk_level: RiskLevel
  matched_patterns: string[]
  reason: string
  excerpt: string
}

export type AnalysisDetails = {
  classifier_mode: ClassifierMode
  threshold_used: number
  preprocessing: PreprocessingSummary
  chunking: ChunkingInfo
  feature_evidence: FeatureEvidence
  chunk_results: ChunkResult[]
  final_rationale: string
}
