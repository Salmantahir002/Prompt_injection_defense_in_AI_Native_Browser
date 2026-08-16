"""
Agent Tool Registry
===================
The single source of truth for what the planner is allowed to emit.

The same specs generate the tool documentation inside the prompt AND validate
the model's reply, so a tool can never be described to the planner without
being validatable, or accepted without being described. Adding a tool is a
one-place change — the planner itself needs no edits (Step 18).
"""

from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import urlparse

# Only ordinary web navigation. Mirrors the Browser Runtime's own allowlist so
# a blocked scheme is rejected before it ever reaches the browser.
ALLOWED_URL_SCHEMES = {"http", "https"}

MAX_TEXT_ARGUMENT_LENGTH = 5_000


class ToolValidationError(ValueError):
    """Raised when a planner reply does not satisfy the registry."""


@dataclass(frozen=True)
class ToolParameter:
    name: str
    kind: str  # "string" | "number" | "element_id" | "url"
    required: bool
    description: str


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: Tuple[ToolParameter, ...] = ()
    """Which subsystem executes the tool. New categories need no planner change."""
    category: str = "browser"
    """When true the runtime must obtain explicit human consent before executing."""
    requires_approval: bool = False
    """True for tools the runtime resolves itself rather than sending to the browser."""
    handled_by_loop: bool = False

    def signature(self) -> str:
        """Compact one-line form used in the planner prompt."""
        if not self.parameters:
            return f'{{"tool": "{self.name}"}}'

        rendered = ", ".join(
            f'"{parameter.name}": <{parameter.kind}{"" if parameter.required else "?"}>'
            for parameter in self.parameters
        )
        return f'{{"tool": "{self.name}", "arguments": {{{rendered}}}}}'


TOOL_SPECS: Tuple[ToolSpec, ...] = (
    ToolSpec(
        name="click",
        description=(
            "Click an element on the page (button, link, option, tab). "
            "Never use click on a Search button before entering the search query into the search input."
        ),
        parameters=(
            ToolParameter("target", "element_id", True, "Element id from the page state, e.g. e4"),
        ),
    ),
    ToolSpec(
        name="fill",
        description=(
            "Replace the contents of an editable input field (role 'textbox', 'searchbox', 'combobox', 'input') "
            "with a text value. Always use this to enter search queries or form data."
        ),
        parameters=(
            ToolParameter("target", "element_id", True, "Element id of the input field"),
            ToolParameter("value", "string", True, "Text to enter"),
        ),
    ),
    ToolSpec(
        name="type",
        description="Type text into whatever currently has focus.",
        parameters=(
            ToolParameter("text", "string", True, "Text to type"),
        ),
    ),
    ToolSpec(
        name="press_key",
        # The scope note matters: key events are delivered to the page, not to
        # the browser, so a planner reaching for Control+t to open a tab
        # dispatches a keystroke that succeeds and does nothing.
        description=(
            "Press a single key inside the page, e.g. Enter, Tab, Escape, ArrowDown. "
            "Use 'Enter' after 'fill' to submit a search. "
            "Browser-level shortcuts such as Control+t or Control+w have no effect here "
            "— use open_tab to open a tab."
        ),
        parameters=(
            ToolParameter("key", "string", True, "Key name"),
        ),
    ),
    ToolSpec(
        name="navigate",
        description="Load a new http(s) url.",
        parameters=(
            ToolParameter("url", "url", True, "Absolute http or https url"),
        ),
    ),
    ToolSpec(
        name="open_tab",
        description=(
            "Open a new browser tab and switch to it, optionally loading a url. "
            "This is the only way to open a tab. To load a url in the tab already "
            "showing, use navigate instead."
        ),
        parameters=(
            ToolParameter("url", "url", False, "Absolute http or https url to open in the new tab"),
        ),
        # The tab strip is renderer state, so the agent loop opens the tab and
        # re-points itself at it; the Browser Runtime never sees this tool.
        handled_by_loop=True,
    ),
    ToolSpec(
        name="scroll",
        description="Scroll the page or an element. Positive deltaY scrolls down.",
        parameters=(
            ToolParameter("target", "element_id", False, "Element to scroll over"),
            ToolParameter("deltaX", "number", False, "Horizontal pixels"),
            ToolParameter("deltaY", "number", False, "Vertical pixels"),
        ),
    ),
    ToolSpec(
        name="upload",
        description="Attach files to a file input. Always asks the user to choose the files.",
        parameters=(
            ToolParameter("target", "element_id", True, "Element id of the file input"),
        ),
        category="files",
        requires_approval=True,
    ),
    ToolSpec(
        name="wait",
        description="Wait for the page to finish loading or settle.",
        parameters=(
            ToolParameter("timeoutMs", "number", False, "Maximum wait in milliseconds"),
        ),
    ),
    ToolSpec(
        name="extract",
        description="Record information from the current page into working memory.",
        parameters=(
            ToolParameter("note", "string", True, "What was found"),
        ),
        handled_by_loop=True,
    ),
    ToolSpec(
        name="finish",
        description="The goal is complete, or cannot be completed. Always end with this.",
        parameters=(
            ToolParameter("summary", "string", True, "Outcome for the user"),
        ),
        handled_by_loop=True,
    ),
)

# Mutable so tools can be added at import time by other modules without
# editing the planner. `register_tool` is the only supported way in.
_REGISTRY: Dict[str, ToolSpec] = {spec.name: spec for spec in TOOL_SPECS}


def register_tool(spec: ToolSpec) -> None:
    """
    Adds a tool to the registry.

    The planner needs no change: the tool is documented in the prompt and
    validated on the way back from the same spec (Step 18). The runtime must
    still know how to execute the new tool — a tool the registry advertises but
    nothing can run would produce plans that always fail.

    Deliberately not registered here: `terminal` and `email`. Handing shell
    execution or outbound mail to an agent whose input includes attacker-
    controlled page text converts a prompt injection into remote code
    execution or spam relay. The mechanism supports them; the judgement is
    that this application should not.
    """
    if spec.name in _REGISTRY:
        raise ValueError(f"Tool '{spec.name}' is already registered.")
    _REGISTRY[spec.name] = spec


def all_tools() -> Tuple[ToolSpec, ...]:
    return tuple(_REGISTRY.values())


def requires_approval(tool_name: str) -> bool:
    spec = _REGISTRY.get(tool_name)
    return bool(spec and spec.requires_approval)


class _ToolsByName(Mapping[str, ToolSpec]):
    """Read-only view so callers cannot mutate the registry behind its back."""

    def __getitem__(self, key: str) -> ToolSpec:
        return _REGISTRY[key]

    def __iter__(self):
        return iter(_REGISTRY)

    def __len__(self) -> int:
        return len(_REGISTRY)


TOOLS_BY_NAME: Mapping[str, ToolSpec] = _ToolsByName()


def render_tool_catalogue() -> str:
    """The tool documentation block injected into the planner prompt."""
    lines = []
    for spec in all_tools():
        suffix = " (the user must approve this before it runs)" if spec.requires_approval else ""
        lines.append(f"- {spec.name}: {spec.description}{suffix}")
        lines.append(f"  {spec.signature()}")
    return "\n".join(lines)


def _validate_number(name: str, value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ToolValidationError(f"Argument '{name}' must be a number.")
    return float(value)


def _validate_string(name: str, value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ToolValidationError(f"Argument '{name}' must be a non-empty string.")
    if len(value) > MAX_TEXT_ARGUMENT_LENGTH:
        raise ToolValidationError(f"Argument '{name}' exceeds {MAX_TEXT_ARGUMENT_LENGTH} characters.")
    return value


def _validate_url(name: str, value: Any) -> str:
    url = _validate_string(name, value)
    parsed = urlparse(url)
    if parsed.scheme.lower() not in ALLOWED_URL_SCHEMES:
        raise ToolValidationError(
            f"Argument '{name}' must be an http(s) url; got scheme '{parsed.scheme or 'none'}'."
        )
    if not parsed.netloc:
        raise ToolValidationError(f"Argument '{name}' must be an absolute url with a host.")
    return url


def _validate_element_id(name: str, value: Any, known_element_ids: Optional[Sequence[str]]) -> str:
    element_id = _validate_string(name, value)
    # A planner that invents an element id is hallucinating, and acting on a
    # made-up id would click whatever happens to occupy that slot. Reject it
    # here so the runtime never sees it.
    if known_element_ids is not None and element_id not in known_element_ids:
        raise ToolValidationError(
            f"Argument '{name}' references unknown element '{element_id}'. "
            "Only element ids present in the current page state may be used."
        )
    return element_id


def validate_tool_call(
    payload: Any,
    known_element_ids: Optional[Sequence[str]] = None,
) -> Tuple[str, Dict[str, Any]]:
    """
    Validate a raw planner tool call.

    Returns (tool_name, cleaned_arguments). Unknown arguments are rejected
    rather than dropped, since a planner passing an argument we ignore is a
    planner whose intent we have not actually understood.
    """
    if not isinstance(payload, dict):
        raise ToolValidationError("Planner output must be a JSON object.")

    tool_name = payload.get("tool")
    if not isinstance(tool_name, str) or tool_name not in TOOLS_BY_NAME:
        raise ToolValidationError(
            f"Unknown tool '{tool_name}'. Valid tools: {', '.join(TOOLS_BY_NAME)}."
        )

    spec = TOOLS_BY_NAME[tool_name]
    raw_arguments = payload.get("arguments", {})
    if raw_arguments is None:
        raw_arguments = {}
    if not isinstance(raw_arguments, dict):
        raise ToolValidationError(f"Arguments for '{tool_name}' must be a JSON object.")

    known_parameters = {parameter.name: parameter for parameter in spec.parameters}
    unexpected = sorted(set(raw_arguments) - set(known_parameters))
    if unexpected:
        raise ToolValidationError(
            f"Tool '{tool_name}' does not accept argument(s): {', '.join(unexpected)}."
        )

    cleaned: Dict[str, Any] = {}
    for parameter in spec.parameters:
        if parameter.name not in raw_arguments:
            if parameter.required:
                raise ToolValidationError(f"Tool '{tool_name}' requires argument '{parameter.name}'.")
            continue

        value = raw_arguments[parameter.name]
        if parameter.kind == "number":
            cleaned[parameter.name] = _validate_number(parameter.name, value)
        elif parameter.kind == "url":
            cleaned[parameter.name] = _validate_url(parameter.name, value)
        elif parameter.kind == "element_id":
            cleaned[parameter.name] = _validate_element_id(parameter.name, value, known_element_ids)
        else:
            cleaned[parameter.name] = _validate_string(parameter.name, value)

    return tool_name, cleaned


# A queue exists to save planning round trips on obvious sequences, not to let
# the planner run unsupervised. Longer queues mean more actions between
# security scans.
MAX_QUEUE_LENGTH = 4

# Tools whose element ids come from the state the planner was given.
_ELEMENT_DEPENDENT = {"click", "fill", "upload", "scroll"}


def validate_tool_queue(
    payloads: Any,
    known_element_ids: Optional[Sequence[str]] = None,
) -> List[Tuple[str, Dict[str, Any]]]:
    """
    Validates a short action queue.

    Beyond per-call validation, the queue as a whole must make sense:

    * Nothing may follow `finish` — the task is over.
    * Nothing that targets an element may follow a `navigate`. Element ids
      describe the page the planner was looking at; after a navigation they
      refer to nodes that no longer exist, and acting on them would mean
      clicking whatever happens to occupy that slot on the new page.
    * A tool needing approval must be alone, so the user is asked about a
      specific action rather than a batch they cannot inspect.
    """
    if not isinstance(payloads, list) or not payloads:
        raise ToolValidationError("Planner must return at least one tool call.")
    if len(payloads) > MAX_QUEUE_LENGTH:
        raise ToolValidationError(f"Planner returned more than {MAX_QUEUE_LENGTH} queued actions.")

    validated: List[Tuple[str, Dict[str, Any]]] = []
    navigated = False

    for index, payload in enumerate(payloads):
        tool_name, arguments = validate_tool_call(payload, known_element_ids)

        if index > 0 and validated[-1][0] == "finish":
            raise ToolValidationError("No action may follow 'finish'.")

        if navigated and tool_name in _ELEMENT_DEPENDENT:
            raise ToolValidationError(
                f"'{tool_name}' cannot be queued after 'navigate': element ids from the "
                "previous page are invalid. Plan the next page in a separate step."
            )

        if requires_approval(tool_name) and len(payloads) > 1:
            raise ToolValidationError(
                f"'{tool_name}' needs user approval and must be planned on its own, not queued."
            )

        if tool_name == "navigate":
            navigated = True

        validated.append((tool_name, arguments))

    return validated
