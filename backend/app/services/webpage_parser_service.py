from bs4 import BeautifulSoup, Comment
from typing import Dict, Any


class WebpageParserService:
    """
    Service responsible for parsing HTML string payloads to extract various sections
    of the DOM, such as visible text, hidden text, comments, inputs, and metadata.
    """

    def parse_html(self, html_content: str, url: str = "") -> Dict[str, Any]:
        """
        Parses raw HTML and extracts key textual components for prompt injection scanning.
        """
        if not html_content:
            return {
                "visible_text": "",
                "hidden_text": "",
                "html_comments": "",
                "meta_tags": "",
                "input_values": "",
                "page_title": "",
                "url": url,
            }

        soup = BeautifulSoup(html_content, "html.parser")

        # 1. Page Title
        page_title = soup.title.string.strip() if soup.title and soup.title.string else ""

        # 2. Extract HTML Comments
        comments = soup.find_all(string=lambda text: isinstance(text, Comment))
        html_comments = " ".join([c.strip() for c in comments if c.strip()])

        # 3. Extract Meta Tags
        meta_tags_list = []
        for meta in soup.find_all("meta"):
            content = meta.get("content")
            if content:
                meta_tags_list.append(content.strip())
        meta_tags = " ".join(meta_tags_list)

        # 4. Extract Input Values
        input_values_list = []
        for input_tag in soup.find_all(["input", "textarea"]):
            val = input_tag.get("value") or input_tag.string
            if val:
                input_values_list.append(str(val).strip())
        input_values = " ".join(input_values_list)

        # 5. Extract Hidden Elements
        hidden_texts = []
        # Find display:none, visibility:hidden, hidden attributes, aria-hidden
        for tag in soup.find_all(True):
            style = tag.get("style", "")
            has_hidden_attr = tag.has_attr("hidden")
            is_aria_hidden = tag.get("aria-hidden") == "true"
            
            is_hidden = (
                "display:none" in style.replace(" ", "") or
                "display: none" in style or
                "visibility:hidden" in style.replace(" ", "") or
                "visibility: hidden" in style or
                has_hidden_attr or
                is_aria_hidden
            )
            if is_hidden and tag.text:
                hidden_texts.append(tag.text.strip())
        
        hidden_text = " ".join([t for t in hidden_texts if t])

        # 6. Extract Visible Text
        # Strip script and style elements first
        for script_or_style in soup(["script", "style"]):
            script_or_style.decompose()

        # Get text representing visible elements
        visible_text = soup.get_text(separator=" ")
        # Clean up whitespace
        visible_text = " ".join([w for w in visible_text.split() if w])

        return {
            "visible_text": visible_text,
            "hidden_text": hidden_text,
            "html_comments": html_comments,
            "meta_tags": meta_tags,
            "input_values": input_values,
            "page_title": page_title,
            "url": url,
        }


# Export a singleton instance
webpage_parser_service = WebpageParserService()
