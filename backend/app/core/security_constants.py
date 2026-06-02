# Security Constants for Prompt Injection Detection

OVERRIDE_INSTRUCTIONS = [
    "ignore previous",
    "ignore all previous instructions",
    "ignore all previous",
    "disregard all",
    "forget your instructions",
    "forget previous",
    "override instructions",
    "disregard previous",
    "forget what you were told",
    "stop following instructions",
    "ignore above",
    "ignore below",
    "new instructions start now",
    "do not write the previous",
    "ignore the instructions",
    "system overrides",
]

JAILBREAK_ATTEMPT = [
    "dan",
    "do anything now",
    "developer mode",
    "bypass restrictions",
    "jailbreak",
    "unlocked mode",
    "no rules",
    "bypass boundaries",
    "pretend you are",
    "acting as",
    "without constraints",
    "allow explicit content",
    "bypass filter",
    "ignore guardrails",
]

HIDDEN_INSTRUCTION = [
    "hidden instruction",
    "invisible text",
    "execute secretly",
    "do not show the user",
    "keep this secret",
    "run in background",
    "silent instruction",
    "background task",
    "secret directive",
    "do not print this",
    "process silently",
]

SYSTEM_PROMPT_REVEAL = [
    "reveal system prompt",
    "reveal your system prompt",
    "show your instructions",
    "what are your rules",
    "output the initialization",
    "print system message",
    "what is your system prompt",
    "how were you configured",
    "provide your system instructions",
    "reveal guidelines",
]

DATA_EXFILTRATION = [
    "export all data",
    "export all user data",
    "send to external",
    "extract user",
    "exfiltrate",
    "send to http",
    "leak info",
    "transfer credentials",
    "upload to",
    "send user data",
    "exfiltrate history",
]

# Mapping category names to lists for iterative inspection
ALL_INDICATORS = {
    "override_instructions": OVERRIDE_INSTRUCTIONS,
    "jailbreak_attempt": JAILBREAK_ATTEMPT,
    "hidden_instruction": HIDDEN_INSTRUCTION,
    "system_prompt_reveal": SYSTEM_PROMPT_REVEAL,
    "data_exfiltration": DATA_EXFILTRATION,
}
