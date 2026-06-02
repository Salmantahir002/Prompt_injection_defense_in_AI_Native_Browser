from typing import List, Literal

from pydantic import BaseModel


class PreprocessingSummary(BaseModel):
    original_length: int
    normalized_length: int
    token_count: int
    steps_applied: List[str]


class ChunkingInfo(BaseModel):
    chunk_count: int
    chunk_size: int
    overlap: int
    highest_risk_chunk_id: str


class FeatureEvidence(BaseModel):
    top_terms: List[str]
    instruction_density: float
    role_override_count: int
    data_exfiltration_count: int
    semantic_similarity_to_malicious_patterns: float
    embedding_or_vectorizer_used: str


class ChunkResult(BaseModel):
    chunk_id: str
    label: Literal["benign", "malicious"]
    confidence: float
    risk_level: Literal["low", "medium", "high"]
    matched_patterns: List[str]
    reason: str
    excerpt: str


class AnalysisDetails(BaseModel):
    classifier_mode: Literal["ml_model", "rule_based_fallback"]
    threshold_used: float
    preprocessing: PreprocessingSummary
    chunking: ChunkingInfo
    feature_evidence: FeatureEvidence
    chunk_results: List[ChunkResult]
    final_rationale: str
