"""
Agent Schemas
=============
Request/response contracts for the autonomous agent planner.

These are deliberately separate from the security and llm schemas: the agent
runtime is an isolated subsystem and changes here must never ripple into the
manual "Scan Page" or chat flows.
"""

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class AgentSemanticElement(BaseModel):
    """One actionable element, as produced by the frontend State Builder."""

    id: str
    role: str
    name: str = ""
    value: Optional[str] = None
    description: Optional[str] = None
    url: Optional[str] = None
    disabled: Optional[bool] = None
    required: Optional[bool] = None
    focused: Optional[bool] = None
    expanded: Optional[bool] = None
    selected: Optional[bool] = None
    checked: Optional[str] = None
    invalid: Optional[str] = None
    nearbyText: Optional[str] = None
    placeholder: Optional[str] = None
    container: Optional[str] = None
    inputType: Optional[str] = None
    nameAttr: Optional[str] = None


class AgentSemanticDialog(BaseModel):
    id: str
    role: str
    name: str = ""
    modal: bool = False


class AgentValidationIssue(BaseModel):
    elementId: str
    role: str
    message: str = ""


class AgentPageState(BaseModel):
    """The compact semantic state. The raw accessibility tree never arrives here."""

    url: str = ""
    title: str = ""
    elements: List[AgentSemanticElement] = Field(default_factory=list)
    focusedElementId: Optional[str] = None
    dialogs: List[AgentSemanticDialog] = Field(default_factory=list)
    validationErrors: List[AgentValidationIssue] = Field(default_factory=list)
    selectedElementIds: List[str] = Field(default_factory=list)
    truncated: bool = False


class AgentStepRecord(BaseModel):
    tool: str
    summary: str = ""
    succeeded: bool = True


class AgentFailureRecord(BaseModel):
    tool: str
    reason: str = ""
    code: Optional[str] = None


class AgentWorkingMemory(BaseModel):
    """
    The planner's entire recollection. Deliberately not a conversation
    transcript: a bounded, structured summary keeps the prompt small and stops
    older page content from accumulating in context.
    """

    goal: str = ""
    completed_steps: List[AgentStepRecord] = Field(default_factory=list)
    pending_steps: List[str] = Field(default_factory=list)
    failures: List[AgentFailureRecord] = Field(default_factory=list)
    retries: int = 0
    current_page: str = ""


class AgentPlanRequest(BaseModel):
    goal: str
    working_memory: AgentWorkingMemory = Field(default_factory=AgentWorkingMemory)
    page_state: AgentPageState = Field(default_factory=AgentPageState)


class AgentToolCall(BaseModel):
    """A single validated action. `arguments` is already schema-checked."""

    tool: str
    arguments: Dict[str, Any] = Field(default_factory=dict)
    """True when the runtime must obtain explicit human consent first."""
    requires_approval: bool = False


class AgentPageSnapshot(BaseModel):
    """
    Deep CDP capture of the page the agent is about to act on.

    Intentionally a separate model from `WebpageCheckRequest`, even though the
    field names overlap. The manual scan contract and the agent contract must
    be able to change independently — that isolation is the whole point.
    """

    visible_text: str = ""
    hidden_text: str = ""
    html_comments: str = ""
    meta_tags: str = ""
    input_values: str = ""
    aria_text: str = ""
    iframe_content: str = ""
    shadow_dom_content: str = ""
    inline_javascript: str = ""
    external_javascript: str = ""
    css_content: str = ""
    css_generated_content: str = ""
    network_responses: str = ""
    websocket_messages: str = ""
    service_worker_activity: str = ""
    dom_snapshot_content: str = ""
    page_title: str = ""
    url: str = ""


class AgentScanRequest(BaseModel):
    """A scan request for one agent iteration."""

    task_id: str
    url: str = ""
    page_hash: str = ""
    snapshot: AgentPageSnapshot


class AgentThreatFindingModel(BaseModel):
    source: str
    confidence: float
    matched_patterns: List[str] = Field(default_factory=list)
    matched_evidence: List[str] = Field(default_factory=list)
    excerpt: str = ""


class AgentScanResponse(BaseModel):
    """
    The machine decision that gates execution.

    `allowed == False` trips the runtime circuit breaker: the pending planner
    action is discarded and the task ends.
    """

    allowed: bool
    task_id: str
    url: str = ""
    page_hash: str = ""
    risk_level: Literal["low", "medium", "high"]
    confidence: float
    summary_reason: str
    matched_patterns: List[str] = Field(default_factory=list)
    blocked_sources: List[str] = Field(default_factory=list)
    findings: List[AgentThreatFindingModel] = Field(default_factory=list)
    scanned_chunks: int = 0
    classifier_mode: str = ""
    scanned_at: str = ""


class AgentPlanResponse(BaseModel):
    """
    The next action, or a short queue of them.

    `tool_call` is the first queued action, kept so a caller that only ever
    executes one action at a time needs no change.
    """

    tool_calls: List[AgentToolCall] = Field(min_length=1)
    tool_call: AgentToolCall
    confidence: float = Field(ge=0.0, le=1.0)
    """True when confidence fell below the configured threshold and the runtime
    should pause for the user instead of executing."""
    needs_user_confirmation: bool = False
    reason: str = ""
    model: str = ""
    planner_mode: Literal["llm"] = "llm"
