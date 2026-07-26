from typing import Dict, Any, List
from app.core.security_constants import ALL_INDICATORS


# These terms often appear in legitimate tutorials, news, video titles, and
# accessibility labels. They are useful corroborating evidence, but are not an
# indirect prompt injection by themselves.
WEAK_JAILBREAK_TERMS = {
    "dan", "developer mode", "jailbreak", "unlocked mode", "no rules",
    "acting as", "without constraints", "allow explicit content",
}
INSTRUCTION_CONTEXT_TERMS = (
    "ignore", "disregard", "forget", "override", "bypass", "pretend",
    "you are", "you must", "you should", "follow", "reveal", "show",
    "send", "export", "upload", "execute", "do not", "please",
)


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

        has_instruction_context = any(term in search_text for term in INSTRUCTION_CONTEXT_TERMS)

        # Run signature matching for each category. A bare "jailbreak" (for
        # example, a video title) is not enough to block a page; it needs an
        # instruction-like context or corroboration from another category.
        for category_name, keyword_list in ALL_INDICATORS.items():
            matches = []
            for keyword in keyword_list:
                if keyword not in search_text:
                    continue
                if category_name == "jailbreak_attempt" and keyword in WEAK_JAILBREAK_TERMS and not has_instruction_context:
                    continue
                # Find direct substring matches after contextual filtering.
                if keyword in search_text:
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
