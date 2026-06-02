import re
from typing import Dict, Any, List
from collections import Counter


class FeatureExplanationService:
    """
    Service responsible for computing feature metrics and evidence explanations
    to make the classifier decisions understandable to the user.
    """

    def extract_features(self, text: str, pattern_evidence: Dict[str, List[str]]) -> Dict[str, Any]:
        """
        Extracts structural features, term counts, and top terms from the text.
        """
        # Tokenize text
        words = [w for w in re.findall(r"\b\w{3,}\b", text.lower())]
        word_count = len(words)

        # Count occurrences of matched keywords
        role_override_count = 0
        data_exfiltration_count = 0

        for category, matched_keywords in pattern_evidence.items():
            count = len(matched_keywords)
            if category in ["override_instructions", "jailbreak_attempt"]:
                role_override_count += count
            elif category == "data_exfiltration":
                data_exfiltration_count += count

        # Compute instruction density (proportion of suspicious words/phrases relative to document length)
        # Approximate: total words matched / total word count
        instruction_density = 0.0
        if word_count > 0:
            # Let's count approximate word matches from keywords
            matched_words_total = 0
            for category, matched_keywords in pattern_evidence.items():
                for kw in matched_keywords:
                    matched_words_total += len(kw.split(" "))
            instruction_density = min(1.0, matched_words_total / word_count)

        # Extract top terms (excluding basic stopwords)
        stop_words = {
            "the", "and", "a", "of", "to", "is", "in", "that", "this", "it", "you", "for", 
            "was", "on", "are", "as", "with", "his", "they", "i", "at", "be", "this", "have"
        }
        filtered_words = [w for w in words if w not in stop_words and len(w) > 3]
        term_freqs = Counter(filtered_words)
        top_terms = [item[0] for item in term_freqs.most_common(5)]

        return {
            "instruction_density": round(instruction_density, 3),
            "role_override_count": role_override_count,
            "data_exfiltration_count": data_exfiltration_count,
            "semantic_similarity_to_malicious_patterns": 0.0,
            "top_terms": top_terms,
            "embedding_or_vectorizer_used": "rule_based_fallback_terms"
        }


# Export a singleton instance
feature_explanation_service = FeatureExplanationService()
