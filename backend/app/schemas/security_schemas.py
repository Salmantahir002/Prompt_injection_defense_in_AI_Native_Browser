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
    aria_text: str = ""
    iframe_content: str = ""
    shadow_dom_content: str = ""
    external_javascript: str = ""
    inline_javascript: str = ""
    css_content: str = ""
    css_generated_content: str = ""
    network_responses: str = ""
    websocket_messages: str = ""
    service_worker_activity: str = ""
    source_maps: str = ""
    redirects: str = ""
    third_party_resources: str = ""
    suspicious_domains: str = ""
    frame_navigation: str = ""
    runtime_script_activity: str = ""
    loaded_resources: str = ""
    dom_snapshot_content: str = ""


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
