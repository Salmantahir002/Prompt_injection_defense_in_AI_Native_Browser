import pytest

from app.services.agent_tool_registry import (
    TOOLS_BY_NAME,
    ToolValidationError,
    render_tool_catalogue,
    validate_tool_call,
)

KNOWN_IDS = ["e1", "e2", "e3"]


def test_valid_click_is_accepted():
    tool, arguments = validate_tool_call({"tool": "click", "arguments": {"target": "e2"}}, KNOWN_IDS)
    assert tool == "click"
    assert arguments == {"target": "e2"}


def test_valid_fill_is_accepted():
    tool, arguments = validate_tool_call(
        {"tool": "fill", "arguments": {"target": "e1", "value": "hello"}}, KNOWN_IDS
    )
    assert tool == "fill"
    assert arguments == {"target": "e1", "value": "hello"}


def test_tool_with_no_arguments_is_accepted():
    tool, arguments = validate_tool_call({"tool": "wait"}, KNOWN_IDS)
    assert tool == "wait"
    assert arguments == {}


def test_unknown_tool_is_rejected():
    with pytest.raises(ToolValidationError, match="Unknown tool"):
        validate_tool_call({"tool": "execute_shell", "arguments": {}}, KNOWN_IDS)


def test_missing_required_argument_is_rejected():
    with pytest.raises(ToolValidationError, match="requires argument 'target'"):
        validate_tool_call({"tool": "click", "arguments": {}}, KNOWN_IDS)


def test_unexpected_argument_is_rejected():
    with pytest.raises(ToolValidationError, match="does not accept argument"):
        validate_tool_call({"tool": "click", "arguments": {"target": "e1", "force": True}}, KNOWN_IDS)


def test_hallucinated_element_id_is_rejected():
    """A planner inventing an id would make the runtime click an unrelated node."""
    with pytest.raises(ToolValidationError, match="unknown element 'e99'"):
        validate_tool_call({"tool": "click", "arguments": {"target": "e99"}}, KNOWN_IDS)


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "file:///etc/passwd",
        "data:text/html,<script>x</script>",
        "/relative/path",
    ],
)
def test_dangerous_navigation_schemes_are_rejected(url):
    with pytest.raises(ToolValidationError):
        validate_tool_call({"tool": "navigate", "arguments": {"url": url}}, KNOWN_IDS)


def test_https_navigation_is_accepted():
    tool, arguments = validate_tool_call(
        {"tool": "navigate", "arguments": {"url": "https://example.com/x"}}, KNOWN_IDS
    )
    assert tool == "navigate"
    assert arguments["url"] == "https://example.com/x"


def test_number_argument_rejects_string():
    with pytest.raises(ToolValidationError, match="must be a number"):
        validate_tool_call({"tool": "scroll", "arguments": {"deltaY": "down"}}, KNOWN_IDS)


def test_boolean_is_not_accepted_as_number():
    with pytest.raises(ToolValidationError, match="must be a number"):
        validate_tool_call({"tool": "scroll", "arguments": {"deltaY": True}}, KNOWN_IDS)


def test_empty_string_argument_is_rejected():
    with pytest.raises(ToolValidationError, match="non-empty string"):
        validate_tool_call({"tool": "type", "arguments": {"text": "   "}}, KNOWN_IDS)


def test_oversized_text_is_rejected():
    with pytest.raises(ToolValidationError, match="exceeds"):
        validate_tool_call({"tool": "type", "arguments": {"text": "x" * 6000}}, KNOWN_IDS)


def test_non_object_payload_is_rejected():
    with pytest.raises(ToolValidationError, match="must be a JSON object"):
        validate_tool_call(["click"], KNOWN_IDS)


def test_optional_element_id_still_validated_when_present():
    with pytest.raises(ToolValidationError, match="unknown element"):
        validate_tool_call({"tool": "scroll", "arguments": {"target": "e77"}}, KNOWN_IDS)


def test_scroll_without_target_is_accepted():
    tool, arguments = validate_tool_call({"tool": "scroll", "arguments": {"deltaY": 400}}, KNOWN_IDS)
    assert tool == "scroll"
    assert arguments == {"deltaY": 400.0}


def test_catalogue_documents_every_registered_tool():
    """The prompt must describe exactly the tools the validator accepts."""
    catalogue = render_tool_catalogue()
    for name in TOOLS_BY_NAME:
        assert f"- {name}:" in catalogue
