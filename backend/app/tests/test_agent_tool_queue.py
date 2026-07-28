"""Coverage for multi-step action queues and the extensible tool registry."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.agent_planner_service import AgentPlannerService
from app.services.agent_tool_registry import (
    MAX_QUEUE_LENGTH,
    ToolSpec,
    ToolParameter,
    ToolValidationError,
    all_tools,
    register_tool,
    render_tool_catalogue,
    requires_approval,
    validate_tool_queue,
)

client = TestClient(app)
KNOWN_IDS = ["e1", "e2", "e3"]


# ------------------------------------------------------------------------ queue


def test_single_action_queue_is_accepted():
    actions = validate_tool_queue([{"tool": "click", "arguments": {"target": "e1"}}], KNOWN_IDS)
    assert actions == [("click", {"target": "e1"})]


def test_a_certain_sequence_is_accepted():
    actions = validate_tool_queue(
        [
            {"tool": "fill", "arguments": {"target": "e1", "value": "shoes"}},
            {"tool": "press_key", "arguments": {"key": "Enter"}},
        ],
        KNOWN_IDS,
    )
    assert [name for name, _ in actions] == ["fill", "press_key"]


def test_empty_queue_is_rejected():
    with pytest.raises(ToolValidationError, match="at least one"):
        validate_tool_queue([], KNOWN_IDS)


def test_overlong_queue_is_rejected():
    payload = [{"tool": "wait"} for _ in range(MAX_QUEUE_LENGTH + 1)]
    with pytest.raises(ToolValidationError, match="more than"):
        validate_tool_queue(payload, KNOWN_IDS)


def test_nothing_may_follow_finish():
    with pytest.raises(ToolValidationError, match="follow 'finish'"):
        validate_tool_queue(
            [{"tool": "finish", "arguments": {"summary": "done"}}, {"tool": "click", "arguments": {"target": "e1"}}],
            KNOWN_IDS,
        )


def test_element_action_cannot_be_queued_after_navigate():
    """
    Element ids describe the page the planner saw. After a navigation they
    point at nodes that no longer exist.
    """
    with pytest.raises(ToolValidationError, match="cannot be queued after 'navigate'"):
        validate_tool_queue(
            [
                {"tool": "navigate", "arguments": {"url": "https://example.test"}},
                {"tool": "click", "arguments": {"target": "e1"}},
            ],
            KNOWN_IDS,
        )


def test_non_element_action_may_follow_navigate():
    actions = validate_tool_queue(
        [{"tool": "navigate", "arguments": {"url": "https://example.test"}}, {"tool": "wait"}],
        KNOWN_IDS,
    )
    assert [name for name, _ in actions] == ["navigate", "wait"]


def test_an_approval_tool_may_not_be_hidden_inside_a_queue():
    """The user must be asked about a specific action, not an unreviewable batch."""
    with pytest.raises(ToolValidationError, match="must be planned on its own"):
        validate_tool_queue(
            [{"tool": "click", "arguments": {"target": "e1"}}, {"tool": "upload", "arguments": {"target": "e2"}}],
            KNOWN_IDS,
        )


def test_an_invalid_action_rejects_the_whole_queue():
    with pytest.raises(ToolValidationError):
        validate_tool_queue(
            [{"tool": "click", "arguments": {"target": "e1"}}, {"tool": "click", "arguments": {"target": "e99"}}],
            KNOWN_IDS,
        )


# --------------------------------------------------------------------- registry


def test_upload_requires_approval_and_click_does_not():
    assert requires_approval("upload") is True
    assert requires_approval("click") is False
    assert requires_approval("nonexistent") is False


def test_dangerous_tools_are_not_registered():
    """
    Shell execution and outbound mail would turn a prompt injection into
    remote code execution or a spam relay.
    """
    names = {spec.name for spec in all_tools()}
    assert "terminal" not in names
    assert "email" not in names
    assert "shell" not in names


def test_a_new_tool_appears_in_the_prompt_without_touching_the_planner():
    spec = ToolSpec(
        name="test_only_clipboard",
        description="Copy text to the clipboard.",
        parameters=(ToolParameter("text", "string", True, "Text to copy"),),
        category="clipboard",
    )
    register_tool(spec)
    try:
        assert "- test_only_clipboard:" in render_tool_catalogue()
        actions = validate_tool_queue(
            [{"tool": "test_only_clipboard", "arguments": {"text": "hi"}}], KNOWN_IDS
        )
        assert actions == [("test_only_clipboard", {"text": "hi"})]

        # And it is advertised to the UI.
        names = {tool["name"] for tool in client.get("/api/v1/agent/tools").json()}
        assert "test_only_clipboard" in names
    finally:
        from app.services import agent_tool_registry
        agent_tool_registry._REGISTRY.pop("test_only_clipboard", None)


def test_duplicate_registration_is_refused():
    with pytest.raises(ValueError, match="already registered"):
        register_tool(ToolSpec(name="click", description="dupe"))


def test_tools_endpoint_exposes_approval_metadata():
    tools = {tool["name"]: tool for tool in client.get("/api/v1/agent/tools").json()}
    assert tools["upload"]["requires_approval"] is True
    assert tools["upload"]["category"] == "files"
    assert tools["finish"]["handled_by_loop"] is True


# ------------------------------------------------------------------ end to end


@pytest.fixture
def configured_planner(monkeypatch):
    monkeypatch.setattr(AgentPlannerService, "is_configured", property(lambda self: True))


def _plan_body():
    return {
        "goal": "search",
        "working_memory": {"goal": "search"},
        "page_state": {
            "url": "https://x.test",
            "title": "X",
            "elements": [{"id": "e1", "role": "searchbox", "name": "Search"}],
            "dialogs": [],
            "validationErrors": [],
            "selectedElementIds": [],
            "truncated": False,
        },
    }


def test_queue_is_returned_through_the_endpoint(configured_planner, monkeypatch):
    async def fake_call(self, messages):
        return (
            '{"actions": [{"tool": "fill", "arguments": {"target": "e1", "value": "shoes"}},'
            ' {"tool": "press_key", "arguments": {"key": "Enter"}}], "confidence": 0.9}'
        )

    monkeypatch.setattr(AgentPlannerService, "_call_model", fake_call)

    body = client.post("/api/v1/agent/plan", json=_plan_body()).json()
    assert [call["tool"] for call in body["tool_calls"]] == ["fill", "press_key"]
    # tool_call stays the first action for single-action callers.
    assert body["tool_call"]["tool"] == "fill"


def test_queued_click_after_navigate_is_refused_by_the_endpoint(configured_planner, monkeypatch):
    async def fake_call(self, messages):
        return (
            '{"actions": [{"tool": "navigate", "arguments": {"url": "https://evil.test"}},'
            ' {"tool": "click", "arguments": {"target": "e1"}}], "confidence": 1.0}'
        )

    monkeypatch.setattr(AgentPlannerService, "_call_model", fake_call)

    response = client.post("/api/v1/agent/plan", json=_plan_body())
    assert response.status_code == 422


def test_upload_is_flagged_for_approval_through_the_endpoint(configured_planner, monkeypatch):
    async def fake_call(self, messages):
        return '{"actions": [{"tool": "upload", "arguments": {"target": "e1"}}], "confidence": 0.9}'

    monkeypatch.setattr(AgentPlannerService, "_call_model", fake_call)

    body = client.post("/api/v1/agent/plan", json=_plan_body()).json()
    assert body["tool_calls"][0]["requires_approval"] is True
