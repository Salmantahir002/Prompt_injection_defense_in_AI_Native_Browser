from typing import List, Literal

from pydantic import BaseModel

from app.schemas.analysis_details_schemas import AnalysisDetails


class PromptCheckRequest(BaseModel):
    prompt: str


class SecurityCheckResponse(BaseModel):
    allowed: bool
    label: Literal["benign", "malicious"]
    confidence: float
    risk_level: Literal["low", "medium", "high"]
    summary_reason: str
    matched_patterns: List[str]
    source: Literal["direct_prompt"]
    timestamp: str
    analysis_details: AnalysisDetails
