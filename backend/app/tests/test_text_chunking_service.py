"""
Tests for TextChunkingService
================================
Validates text chunking logic with different sizes and overlaps.
"""

import os
import pytest

os.chdir(os.path.join(os.path.dirname(__file__), "..", ".."))

from app.services.text_chunking_service import chunking_service


class TestChunking:
    """Test text chunking functionality."""

    def test_short_text_single_chunk(self):
        """Short text should produce exactly one chunk."""
        text = "This is a short prompt."
        chunks = chunking_service.chunk_text(text, chunk_size=800, overlap=100)
        assert len(chunks) == 1
        assert chunks[0]["text"] == text
        assert chunks[0]["chunk_id"] == "chunk_001"

    def test_long_text_multiple_chunks(self):
        """Long text should produce multiple chunks."""
        text = "word " * 500  # ~2500 chars
        chunks = chunking_service.chunk_text(text, chunk_size=200, overlap=50)
        assert len(chunks) > 1

    def test_chunk_ids_are_sequential(self):
        """Chunk IDs should be sequential."""
        text = "word " * 500
        chunks = chunking_service.chunk_text(text, chunk_size=200, overlap=50)
        for i, chunk in enumerate(chunks):
            expected_id = f"chunk_{i + 1:03d}"
            assert chunk["chunk_id"] == expected_id

    def test_empty_text(self):
        """Empty text should return no chunks."""
        chunks = chunking_service.chunk_text("", chunk_size=800, overlap=100)
        assert len(chunks) == 0

    def test_exact_chunk_size(self):
        """Text exactly at chunk_size should produce one chunk."""
        text = "a" * 800
        chunks = chunking_service.chunk_text(text, chunk_size=800, overlap=100)
        assert len(chunks) == 1

    def test_chunks_contain_text(self):
        """All chunks should contain non-empty text for non-empty input."""
        text = "Hello world. " * 100
        chunks = chunking_service.chunk_text(text, chunk_size=200, overlap=50)
        for chunk in chunks:
            assert len(chunk["text"]) > 0

    def test_chunk_keys(self):
        """Each chunk should have chunk_id and text keys."""
        chunks = chunking_service.chunk_text("Test input", chunk_size=800, overlap=100)
        for chunk in chunks:
            assert "chunk_id" in chunk
            assert "text" in chunk
