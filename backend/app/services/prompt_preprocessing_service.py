import re
from bs4 import BeautifulSoup
from typing import Dict, Any, Tuple


class PromptPreprocessingService:
    """
    Service responsible for cleaning, normalizing, and calculating basic
    metadata about text prompts before security analysis.
    """

    def preprocess(self, text: str) -> Tuple[str, Dict[str, Any]]:
        """
        Preprocesses raw text and returns a tuple of (normalized_text, summary_dict).
        """
        original_length = len(text)
        steps_applied = []

        # 1. Strip HTML tags if present (heuristic check)
        cleaned_text = text
        if "<" in text and ">" in text:
            try:
                soup = BeautifulSoup(text, "html.parser")
                cleaned_text = soup.get_text()
                steps_applied.append("html_strip")
            except Exception:
                # Fallback: simple regex strip if BeautifulSoup fails
                cleaned_text = re.sub(r"<[^>]+>", "", text)
                steps_applied.append("regex_html_strip")

        # 2. Lowercase conversion (for case-insensitive matching)
        normalized_text = cleaned_text.lower()
        steps_applied.append("lowercase")

        # 3. Whitespace normalization (remove duplicate spaces, tabs, newlines)
        normalized_text = re.sub(r"\s+", " ", normalized_text).strip()
        steps_applied.append("whitespace_normalization")

        normalized_length = len(normalized_text)
        
        # Approximate token count (split by word boundaries)
        tokens = [t for t in normalized_text.split(" ") if t]
        token_count = len(tokens)

        summary = {
            "original_length": original_length,
            "normalized_length": normalized_length,
            "token_count": token_count,
            "steps_applied": steps_applied
        }

        return normalized_text, summary


# Export a singleton instance
preprocessing_service = PromptPreprocessingService()
