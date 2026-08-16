import pytest

from app.schemas.agent_schemas import (
    AgentFailureRecord,
    AgentPageState,
    AgentSemanticDialog,
    AgentSemanticElement,
    AgentStepRecord,
    AgentWorkingMemory,
)
from app.services.agent_planner_service import agent_planner_service
from app.services.agent_tool_registry import ToolValidationError

KNOWN_IDS = ["e1", "e2"]


# ------------------------------------------------------------------ JSON parsing


def test_plain_json_is_parsed():
    actions, confidence, reason = agent_planner_service.parse_plan(
        '{"tool": "click", "arguments": {"target": "e1"}, "confidence": 0.9, "reason": "the login button"}',
        KNOWN_IDS,
    )
    assert actions == [("click", {"target": "e1"})]
    assert confidence == 0.9
    assert reason == "the login button"


def test_json_wrapped_in_markdown_fence_is_parsed():
    raw = '```json\n{"tool": "wait", "confidence": 0.5}\n```'
    actions, _, _ = agent_planner_service.parse_plan(raw, KNOWN_IDS)
    assert actions[0][0] == "wait"


def test_json_surrounded_by_prose_is_parsed():
    raw = 'Sure! Here is the next step:\n{"tool": "finish", "arguments": {"summary": "done"}}\nHope that helps.'
    actions, _, _ = agent_planner_service.parse_plan(raw, KNOWN_IDS)
    assert actions == [("finish", {"summary": "done"})]


def test_braces_inside_string_values_do_not_end_the_scan():
    raw = '{"tool": "type", "arguments": {"text": "a } brace { inside"}, "confidence": 0.8}'
    actions, _, _ = agent_planner_service.parse_plan(raw, KNOWN_IDS)
    assert actions[0][0] == "type"
    assert actions[0][1]["text"] == "a } brace { inside"


def test_escaped_quote_inside_string_is_handled():
    raw = '{"tool": "type", "arguments": {"text": "say \\"hi\\""}}'
    actions, _, _ = agent_planner_service.parse_plan(raw, KNOWN_IDS)
    assert actions[0][1]["text"] == 'say "hi"'


def test_empty_response_is_rejected():
    with pytest.raises(ToolValidationError, match="empty response"):
        agent_planner_service.parse_plan("", KNOWN_IDS)


def test_response_without_json_is_rejected():
    with pytest.raises(ToolValidationError, match="no JSON object"):
        agent_planner_service.parse_plan("I cannot help with that.", KNOWN_IDS)


def test_unterminated_json_is_rejected():
    with pytest.raises(ToolValidationError, match="unterminated"):
        agent_planner_service.parse_plan('{"tool": "click", "arguments": {', KNOWN_IDS)


def test_malformed_json_is_rejected():
    with pytest.raises(ToolValidationError, match="not valid JSON"):
        agent_planner_service.parse_plan('{"tool": "click",,}', KNOWN_IDS)


# -------------------------------------------------------------------- confidence


def test_missing_confidence_defaults_to_midpoint():
    _, confidence, _ = agent_planner_service.parse_plan('{"tool": "wait"}', KNOWN_IDS)
    assert confidence == 0.5


@pytest.mark.parametrize("raw_value,expected", [(5, 1.0), (-2, 0.0), ("high", 0.5), (True, 0.5)])
def test_confidence_is_clamped_and_type_checked(raw_value, expected):
    payload = '{"tool": "wait", "confidence": %s}' % (
        "true" if raw_value is True else ('"high"' if raw_value == "high" else raw_value)
    )
    _, confidence, _ = agent_planner_service.parse_plan(payload, KNOWN_IDS)
    assert confidence == expected


def test_hallucinated_element_id_fails_validation_through_the_planner():
    with pytest.raises(ToolValidationError, match="unknown element"):
        agent_planner_service.parse_plan('{"tool": "click", "arguments": {"target": "e42"}}', KNOWN_IDS)


# ------------------------------------------------------------------ prompt shape


def _sample_state() -> AgentPageState:
    return AgentPageState(
        url="https://shop.test/cart",
        title="Cart",
        elements=[
            AgentSemanticElement(id="e1", role="textbox", name="Coupon", required=True),
            AgentSemanticElement(id="e2", role="button", name="Apply", disabled=True),
        ],
        focusedElementId="e1",
        dialogs=[AgentSemanticDialog(id="e3", role="dialog", name="Cookies", modal=True)],
    )


def test_prompt_contains_goal_memory_and_state_only():
    memory = AgentWorkingMemory(
        goal="apply a coupon",
        completed_steps=[AgentStepRecord(tool="navigate", summary="opened cart", succeeded=True)],
        failures=[AgentFailureRecord(tool="click", reason="element gone", code="ELEMENT_NOT_FOUND")],
        retries=1,
    )
    messages = agent_planner_service.build_messages("apply a coupon", memory, _sample_state())
    assert [message["role"] for message in messages] == ["system", "user"]

    user_prompt = messages[1]["content"]
    assert "apply a coupon" in user_prompt
    assert "opened cart" in user_prompt
    assert "ELEMENT_NOT_FOUND" in user_prompt
    assert 'e1 [textbox] "Coupon"' in user_prompt
    assert 'e2 [button] "Apply"' in user_prompt
    assert "disabled" in user_prompt
    assert "modal dialog" in user_prompt


def test_page_content_is_fenced_as_untrusted():
    """The boundary between operator instructions and page data must be explicit."""
    messages = agent_planner_service.build_messages("x", AgentWorkingMemory(goal="x"), _sample_state())
    user_prompt = messages[1]["content"]
    assert "BEGIN UNTRUSTED PAGE CONTENT" in user_prompt
    assert "END UNTRUSTED PAGE CONTENT" in user_prompt
    # The page block must come after the goal, so the goal cannot be displaced.
    assert user_prompt.index("GOAL:") < user_prompt.index("BEGIN UNTRUSTED PAGE CONTENT")


def test_system_prompt_documents_every_tool_and_the_injection_rule():
    messages = agent_planner_service.build_messages("x", AgentWorkingMemory(goal="x"), _sample_state())
    system_prompt = messages[0]["content"]
    for name in ("click", "fill", "navigate", "finish"):
        assert f"- {name}:" in system_prompt
    assert "CRITICAL SECURITY RULE" in system_prompt
    assert "{tool_catalogue}" not in system_prompt


def test_empty_memory_renders_a_first_step_marker():
    messages = agent_planner_service.build_messages("x", AgentWorkingMemory(goal="x"), _sample_state())
    assert "this is the first step" in messages[1]["content"]


def test_system_prompt_includes_search_and_input_guidelines():
    messages = agent_planner_service.build_messages("search for grok bot", AgentWorkingMemory(goal="search"), _sample_state())
    system_prompt = messages[0]["content"]
    assert "SEARCH & FORM INPUT GUIDELINES" in system_prompt
    assert "NEVER click a \"Search\" or \"Submit\" button (role 'button') while the search input is empty" in system_prompt
    assert "press_key" in system_prompt

