from typing import Dict, Any, List
from app.core.security_constants import ALL_INDICATORS


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

        # Run signature matching for each category
        for category_name, keyword_list in ALL_INDICATORS.items():
            matches = []
            for keyword in keyword_list:
                # Find direct substring matches
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
