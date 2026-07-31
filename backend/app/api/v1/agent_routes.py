"""
Agent Routes
============
POST /api/v1/agent/plan — the autonomous agent's planning endpoint.

This router is reserved for the agent runtime. It is intentionally isolated
from /security/* and /llm/* so that the manual "Scan Page" and chat workflows
and the agent loop can evolve without affecting one another.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException

from app.core.config import settings
from app.schemas.agent_schemas import (
    AgentPlanRequest,
    AgentPlanResponse,
    AgentScanRequest,
    AgentScanResponse,
    AgentToolCall,
)
from app.services.agent_planner_service import agent_planner_service
from app.services.agent_security_event_store import agent_security_event_store
from app.services.agent_security_service import agent_security_service
from app.services.agent_tool_registry import ToolValidationError, all_tools, requires_approval

logger = logging.getLogger(__name__)

router = APIRouter()

# Channels the autonomous agent scans before it is allowed to act.
#
# Held separately from the manual scanner's list (security_routes) so the two
# subsystems stay isolated, but the two must agree — see the note there and
# test_agent_and_manual_scan_agree.py.
AGENT_SCAN_CHANNELS = (
    "visible_text",
    "hidden_text",
    "html_comments",
    "meta_tags",
    "input_values",
    "aria_text",
    "iframe_content",
    "shadow_dom_content",
    "inline_javascript",
    "css_content",
    "css_generated_content",
    "network_responses",
    "websocket_messages",
    "service_worker_activity",
)


@router.post("/agent/plan", response_model=AgentPlanResponse)
async def agent_plan(request: AgentPlanRequest):
    """
    Decide the next browser action.

    The caller supplies the goal, its working memory, and the current semantic
    page state. The reply is a single tool call that has already been validated
    against the tool registry — including a check that every element id it
    references actually exists in the supplied state.
    """
    goal = request.goal.strip()
    if not goal:
        raise HTTPException(status_code=400, detail="Agent goal cannot be empty.")

    if not agent_planner_service.is_configured:
        # A placeholder plan would be a fabricated instruction to drive a real
        # browser, so refuse outright rather than inventing an action.
        raise HTTPException(
            status_code=503,
            detail=(
                "Agent planner unavailable: OPENCODE_ZEN_API_KEY is not configured. "
                "Set it in backend/.env to enable autonomous planning."
            ),
        )

    try:
        actions, confidence, reason = await agent_planner_service.request_plan(
            goal, request.working_memory, request.page_state
        )
    except ToolValidationError as exc:
        # The model produced something we will not execute. Surfaced as 422 so
        # the runtime can retry or replan rather than treating it as an outage.
        logger.warning("Planner produced an invalid tool call: %s", exc)
        raise HTTPException(status_code=422, detail=f"Planner produced an invalid tool call: {exc}") from exc
    except httpx.HTTPStatusError as exc:
        logger.exception("Planner LLM HTTP error: %s", exc.response.status_code)
        raise HTTPException(
            status_code=502,
            detail=f"Planner LLM returned {exc.response.status_code}.",
        ) from exc
    except httpx.RequestError as exc:
        logger.exception("Planner LLM unreachable")
        raise HTTPException(status_code=502, detail=f"Planner LLM is unreachable: {type(exc).__name__}.") from exc

    tool_calls = [
        AgentToolCall(tool=name, arguments=arguments, requires_approval=requires_approval(name))
        for name, arguments in actions
    ]

    return AgentPlanResponse(
        tool_calls=tool_calls,
        tool_call=tool_calls[0],
        confidence=confidence,
        needs_user_confirmation=confidence < settings.AGENT_MIN_CONFIDENCE,
        reason=reason,
        model=agent_planner_service.model,
    )


@router.post("/agent/scan-active-page", response_model=AgentScanResponse)
def agent_scan_active_page(request: AgentScanRequest):
    """
    Security-scan the page the agent is about to act on.

    Reserved exclusively for the autonomous agent runtime. The user-initiated
    "Scan Page" button uses POST /security/check-webpage and must never reach
    this endpoint — the two have separate routes, schemas, aggregation, and
    event logs so that neither can regress the other.

    A response with `allowed == false` is an instruction to the runtime to
    discard any pending planner action and end the task.
    """
    if not request.task_id.strip():
        raise HTTPException(status_code=400, detail="A task_id is required for agent scans.")

    snapshot = request.snapshot
    # Every channel is scanned separately so the runtime learns *where* an
    # injection was planted, not merely that one exists.
    #
    # This list must stay identical to the manual scanner's in
    # security_routes.check_webpage — a user who scans a page by hand and sees
    # "safe" must not then watch the agent refuse the same page.
    # test_agent_and_manual_scan_agree.py enforces that.
    #
    # `dom_snapshot_content` is deliberately absent from both. It is the raw
    # string table from DOMSnapshot.captureSnapshot — every tag name, class,
    # attribute value and URL on the page, with no structure. The readable text
    # in it is already covered by visible_text, hidden_text and aria_text, so
    # it adds no detection reach while adding enormous noise.
    sources = [(name, getattr(snapshot, name)) for name in AGENT_SCAN_CHANNELS]

    if not any(text.strip() for _, text in sources):
        # An empty capture is not evidence of safety. Refuse rather than
        # returning allowed=true, which would let the agent act unscanned.
        raise HTTPException(
            status_code=400,
            detail="Agent page snapshot was empty; cannot certify the page as safe.",
        )

    result = agent_security_service.scan_sources(sources)
    url = request.url or snapshot.url

    agent_security_event_store.add_event(
        task_id=request.task_id,
        url=url,
        allowed=bool(result["allowed"]),
        risk_level=str(result["risk_level"]),
        summary_reason=str(result["summary_reason"]),
        blocked_sources=list(result["blocked_sources"]),  # type: ignore[arg-type]
    )

    if not result["allowed"]:
        logger.warning(
            "[agent-security] Task %s blocked at %s — %s",
            request.task_id, url, result["summary_reason"],
        )

    return AgentScanResponse(
        task_id=request.task_id,
        url=url,
        page_hash=request.page_hash,
        scanned_at=datetime.now(timezone.utc).isoformat(),
        **result,  # type: ignore[arg-type]
    )


@router.get("/agent/security/events")
def agent_security_events(task_id: Optional[str] = None):
    """Agent scan history. Separate from GET /security/events by design."""
    return agent_security_event_store.get_events(task_id)


@router.get("/agent/tools")
def agent_tools():
    """Introspection for the UI: what the planner is currently allowed to do."""
    return [
        {
            "name": spec.name,
            "description": spec.description,
            "category": spec.category,
            "requires_approval": spec.requires_approval,
            "handled_by_loop": spec.handled_by_loop,
            "parameters": [
                {
                    "name": parameter.name,
                    "kind": parameter.kind,
                    "required": parameter.required,
                    "description": parameter.description,
                }
                for parameter in spec.parameters
            ],
        }
        for spec in all_tools()
    ]
