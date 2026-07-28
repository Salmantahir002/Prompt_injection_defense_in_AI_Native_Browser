import re
from functools import lru_cache
from typing import Dict, Any, List, Tuple
from app.core.security_constants import ALL_INDICATORS


# These terms often appear in legitimate tutorials, news, video titles, and
# accessibility labels. They are useful corroborating evidence, but are not an
# indirect prompt injection by themselves.
WEAK_JAILBREAK_TERMS = {
    "dan", "developer mode", "jailbreak", "unlocked mode", "no rules",
    "acting as", "without constraints", "allow explicit content",
}

# Indicators that describe an ordinary action as often as a hostile one.
# "upload to" appears in "upload to your channel" on every video site; "extract
# user" and "leak info" read as product copy as easily as as an attack. Like
# the weak jailbreak terms, they only count when something instruction-like
# sits next to them.
WEAK_TERMS_BY_CATEGORY = {
    "jailbreak_attempt": WEAK_JAILBREAK_TERMS,
    "data_exfiltration": {"upload to", "extract user", "leak info"},
}
# Language that marks nearby text as a directive aimed at an AI assistant
# rather than at a human reader.
#
# Bare imperatives were tried first and were far too common in ordinary pages:
# "show" matched the "Show more images" button on a search results page, and
# "follow" matched "follow every step" in a tutorial. Both turned an article
# that merely mentions jailbreaking into a blocked page. Corroboration now has
# to look like someone talking to a model.
INSTRUCTION_CONTEXT_TERMS = (
    "ignore", "disregard", "override", "bypass", "pretend",
    "you are", "you must", "you should", "you will", "you may not",
    "your instructions", "your rules", "your guidelines", "your system prompt",
    "system prompt", "act as", "respond with", "reply with", "output the",
    "do not tell", "do not reveal", "do not mention", "forget your",
    "forget previous", "from now on",
)

# How near an instruction-like word must be to a weak term to corroborate it.
# Scanning a whole chunk was too generous: a page large enough to contain
# "jailbreak" in one place almost certainly contains "show" or "follow"
# somewhere else, which silently disabled the guard on every big site.
CONTEXT_PROXIMITY_CHARS = 160


@lru_cache(maxsize=2048)
def _term_pattern(term: str) -> re.Pattern:
    """
    Whole-word matcher for an indicator.

    Substring matching made short indicators fire on ordinary English: "dan"
    matched inside "guidance", "abundant" and "dance", which is exactly how a
    safe page ends up blocked. Word boundaries are only applied at edges that
    are alphanumeric, so multi-word and punctuated indicators still match.
    """
    prefix = r"\b" if term[:1].isalnum() else ""
    suffix = r"\b" if term[-1:].isalnum() else ""
    return re.compile(prefix + re.escape(term) + suffix)


def _find_term(text: str, term: str) -> Tuple[int, int] | None:
    match = _term_pattern(term).search(text)
    return (match.start(), match.end()) if match else None


def _has_instruction_context_near(text: str, start: int, end: int) -> bool:
    """
    Looks for an instruction-like word beside the match, excluding the match
    itself. Without that exclusion a term would corroborate itself: "upload to"
    contains "upload", so "upload to your channel" would always look like a
    directive.
    """
    before = text[max(0, start - CONTEXT_PROXIMITY_CHARS):start]
    after = text[end:end + CONTEXT_PROXIMITY_CHARS]
    window = f"{before} {after}"
    return any(_term_pattern(term).search(window) for term in INSTRUCTION_CONTEXT_TERMS)


class RuleBasedDetectorService:
    """
    Service responsible for checking text chunks against known malicious pattern lists
    (override instructions, jailbreaks, hidden directives, exfiltration, etc.).
    """

    def detect(self, text: str) -> Dict[str, Any]:
        """
        Scans text for indicators of prompt injection and returns structured results.
        """
        search_text = text.lower()
        matched_patterns: List[str] = []
        pattern_evidence: Dict[str, List[str]] = {}
        total_keyword_matches = 0

        # Run signature matching for each category. A bare "jailbreak" (for
        # example, a video title) is not enough to block a page; it needs an
        # instruction-like phrase close enough to it to read as a directive.
        for category_name, keyword_list in ALL_INDICATORS.items():
            matches = []
            for keyword in keyword_list:
                span = _find_term(search_text, keyword)
                if span is None:
                    continue

                is_weak = keyword in WEAK_TERMS_BY_CATEGORY.get(category_name, ())
                if is_weak and not _has_instruction_context_near(search_text, *span):
                    continue

                matches.append(keyword)
                total_keyword_matches += 1

            if matches:
                matched_patterns.append(category_name)
                pattern_evidence[category_name] = matches

        is_malicious = len(matched_patterns) > 0
        confidence = 0.0

        if is_malicious:
            # Base confidence based on number of distinct matched categories
            if len(matched_patterns) == 1:
                base_conf = 0.75
            elif len(matched_patterns) == 2:
                base_conf = 0.85
            else:
                base_conf = 0.95

            # Small boost per keyword match to reflect severity
            confidence = min(0.99, base_conf + (0.01 * total_keyword_matches))

        return {
            "is_malicious": is_malicious,
            "confidence": confidence,
            "matched_patterns": matched_patterns,
            "pattern_evidence": pattern_evidence,
        }


# Export a singleton instance
rule_based_detector = RuleBasedDetectorService()
