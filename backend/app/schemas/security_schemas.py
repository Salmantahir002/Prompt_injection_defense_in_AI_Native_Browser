from typing import List, Literal

from pydantic import BaseModel

from app.schemas.analysis_details_schemas import AnalysisDetails


class PromptCheckRequest(BaseModel):
    prompt: str


class WebpageCheckRequest(BaseModel):
    visible_text: str
    hidden_text: str
    html_comments: str
    meta_tags: str
    input_values: str
    page_title: str
    url: str


class SecurityCheckResponse(BaseModel):
    allowed: bool
    label: Literal["benign", "malicious"]
    confidence: float
    risk_level: Literal["low", "medium", "high"]
    summary_reason: str
    matched_patterns: List[str]
    source: Literal["direct_prompt", "webpage_content"]
    timestamp: str
    analysis_details: AnalysisDetails
