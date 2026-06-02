"""
Tests for AnalysisDetails Schema
====================================
Validates the Pydantic schema serialization and structure.
"""

import os
import pytest

os.chdir(os.path.join(os.path.dirname(__file__), "..", ".."))

from app.schemas.analysis_details_schemas import (
    AnalysisDetails,
    ChunkingInfo,
    ChunkResult,
    FeatureEvidence,
    PreprocessingSummary,
)


class TestPreprocessingSummary:
    """Test PreprocessingSummary schema."""

    def test_valid_preprocessing(self):
        summary = PreprocessingSummary(
            original_length=120,
            normalized_length=110,
            token_count=18,
            steps_applied=["lowercase_copy", "whitespace_normalization"],
        )
        assert summary.original_length == 120
        assert summary.token_count == 18
        assert len(summary.steps_applied) == 2


class TestChunkingInfo:
    """Test ChunkingInfo schema."""

    def test_valid_chunking(self):
        info = ChunkingInfo(
            chunk_count=3,
            chunk_size=800,
            overlap=100,
            highest_risk_chunk_id="chunk_002",
        )
        assert info.chunk_count == 3
        assert info.highest_risk_chunk_id == "chunk_002"


class TestChunkResult:
    """Test ChunkResult schema."""

    def test_benign_chunk(self):
        chunk = ChunkResult(
            chunk_id="chunk_001",
            label="benign",
            confidence=0.94,
            risk_level="low",
            matched_patterns=[],
            reason="No suspicious patterns.",
            excerpt="This is a safe chunk.",
        )
        assert chunk.label == "benign"
        assert chunk.risk_level == "low"

    def test_malicious_chunk(self):
        chunk = ChunkResult(
            chunk_id="chunk_002",
            label="malicious",
            confidence=0.92,
            risk_level="high",
            matched_patterns=["override_instructions"],
            reason="Matched override indicators.",
            excerpt="Ignore previous...",
        )
        assert chunk.label == "malicious"
        assert len(chunk.matched_patterns) > 0


class TestFeatureEvidence:
    """Test FeatureEvidence schema."""

    def test_valid_evidence(self):
        evidence = FeatureEvidence(
            top_terms=["ignore", "instructions"],
            instruction_density=0.35,
            role_override_count=2,
            data_exfiltration_count=0,
            semantic_similarity_to_malicious_patterns=0.08,
            embedding_or_vectorizer_used="rule_based_fallback_terms",
        )
        assert evidence.instruction_density == 0.35
        assert evidence.role_override_count == 2


class TestAnalysisDetails:
    """Test full AnalysisDetails schema."""

    def test_full_analysis_details(self):
        details = AnalysisDetails(
            classifier_mode="rule_based_fallback",
            threshold_used=0.70,
            preprocessing=PreprocessingSummary(
                original_length=100,
                normalized_length=95,
                token_count=15,
                steps_applied=["lowercase_copy"],
            ),
            chunking=ChunkingInfo(
                chunk_count=1,
                chunk_size=800,
                overlap=100,
                highest_risk_chunk_id="chunk_001",
            ),
            feature_evidence=FeatureEvidence(
                top_terms=["hello", "world"],
                instruction_density=0.0,
                role_override_count=0,
                data_exfiltration_count=0,
                semantic_similarity_to_malicious_patterns=0.0,
                embedding_or_vectorizer_used="rule_based_fallback_terms",
            ),
            chunk_results=[
                ChunkResult(
                    chunk_id="chunk_001",
                    label="benign",
                    confidence=0.94,
                    risk_level="low",
                    matched_patterns=[],
                    reason="Safe chunk.",
                    excerpt="Hello world.",
                )
            ],
            final_rationale="The input is safe because no chunk crossed the malicious threshold.",
        )
        assert details.classifier_mode == "rule_based_fallback"
        assert len(details.chunk_results) == 1
        assert details.chunk_results[0].label == "benign"

    def test_serialization(self):
        """Test that the schema can be serialized to dict."""
        details = AnalysisDetails(
            classifier_mode="ml_model",
            threshold_used=0.70,
            preprocessing=PreprocessingSummary(
                original_length=50, normalized_length=45, token_count=8, steps_applied=["lowercase_copy"]
            ),
            chunking=ChunkingInfo(
                chunk_count=1, chunk_size=800, overlap=100, highest_risk_chunk_id="chunk_001"
            ),
            feature_evidence=FeatureEvidence(
                top_terms=["test"],
                instruction_density=0.0,
                role_override_count=0,
                data_exfiltration_count=0,
                semantic_similarity_to_malicious_patterns=0.0,
                embedding_or_vectorizer_used="tfidf",
            ),
            chunk_results=[
                ChunkResult(
                    chunk_id="chunk_001", label="benign", confidence=0.95,
                    risk_level="low", matched_patterns=[], reason="Safe.", excerpt="Test.",
                )
            ],
            final_rationale="Safe input.",
        )
        data = details.model_dump()
        assert isinstance(data, dict)
        assert data["classifier_mode"] == "ml_model"
