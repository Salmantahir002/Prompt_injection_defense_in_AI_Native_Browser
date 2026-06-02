from typing import List, Dict, Any


class TextChunkingService:
    """
    Service responsible for dividing input text into manageable chunks
    for localized analysis, applying overlapping boundaries.
    """

    def chunk_text(self, text: str, chunk_size: int, overlap: int) -> List[Dict[str, Any]]:
        """
        Splits text into chunks of `chunk_size` characters with `overlap` character overlap.
        """
        if not text:
            return []

        # Validate parameters and fall back to sensible defaults
        if chunk_size <= 0:
            chunk_size = 800
        if overlap < 0 or overlap >= chunk_size:
            overlap = 100

        chunks = []
        text_len = len(text)
        start = 0
        chunk_idx = 1

        while start < text_len:
            # Determine end position
            end = min(start + chunk_size, text_len)
            chunk_content = text[start:end]

            chunks.append({
                "chunk_id": f"chunk_{chunk_idx:03d}",
                "text": chunk_content
            })

            chunk_idx += 1

            # Break if we reached the end of the text
            if end >= text_len:
                break

            # Slide window forward by (size - overlap)
            start += (chunk_size - overlap)

        return chunks


# Export a singleton instance
chunking_service = TextChunkingService()
