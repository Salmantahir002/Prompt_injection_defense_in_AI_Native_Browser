from datetime import datetime, timezone
from typing import Dict, List

from fastapi import APIRouter, HTTPException

from app.core.config import settings
from app.schemas.analysis_details_schemas import (
    AnalysisDetails,
    ChunkingInfo,
    ChunkResult,
    FeatureEvidence,
    PreprocessingSummary,
)
from app.schemas.security_schemas import PromptCheckRequest, SecurityCheckResponse, WebpageCheckRequest
from app.services.feature_explanation_service import feature_explanation_service
from app.services.prompt_preprocessing_service import preprocessing_service
from app.services.prompt_classifier_service import prompt_classifier
from app.services.security_event_store import security_event_store
from app.services.text_chunking_service import chunking_service

router = APIRouter()


def risk_level_for_confidence(confidence: float) -> str:
    if confidence >= 0.85:
        return "high"
    if confidence >= settings.CLASSIFIER_THRESHOLD:
        return "medium"
    return "low"


def excerpt_for_display(text: str) -> str:
    return text[:140] + "..." if len(text) > 140 else text


def chunk_reason(label: str, matched_patterns: List[str]) -> str:
    if label == "malicious":
        return f"Chunk matched prompt injection indicators: {', '.join(matched_patterns)}."

    return "Chunk does not contain suspicious override, reveal, hidden instruction, or exfiltration intent."


def analyze_text(raw_text: str, source: str) -> SecurityCheckResponse:
    normalized_prompt, preprocessing_data = preprocessing_service.preprocess(raw_text)
    preprocessing = PreprocessingSummary(**preprocessing_data)

    chunk_size = settings.DEFAULT_CHUNK_SIZE
    overlap = settings.DEFAULT_CHUNK_OVERLAP
    chunks = chunking_service.chunk_text(normalized_prompt, chunk_size, overlap)

    chunk_results: List[ChunkResult] = []
    aggregated_evidence: Dict[str, List[str]] = {}

    for chunk in chunks:
        detector_result = prompt_classifier.classify(chunk["text"])
        label = "malicious" if detector_result["is_malicious"] else "benign"
        confidence = detector_result["confidence"] if label == "malicious" else 0.94
        matched_patterns = detector_result["matched_patterns"]
        chunk_classifier_mode = detector_result.get("classifier_mode", "rule_based_fallback")

        for category, keywords in detector_result["pattern_evidence"].items():
            aggregated_evidence.setdefault(category, [])
            for keyword in keywords:
                if keyword not in aggregated_evidence[category]:
                    aggregated_evidence[category].append(keyword)

        chunk_results.append(
            ChunkResult(
                chunk_id=chunk["chunk_id"],
                label=label,
                confidence=confidence,
                risk_level="low" if label == "benign" else risk_level_for_confidence(confidence),
                matched_patterns=matched_patterns,
                reason=chunk_reason(label, matched_patterns),
                excerpt=excerpt_for_display(chunk["text"]),
            )
        )

    malicious_chunks = [chunk for chunk in chunk_results if chunk.label == "malicious"]
    allowed = not malicious_chunks
    label = "benign" if allowed else "malicious"
    confidence = 0.94 if allowed else max(chunk.confidence for chunk in malicious_chunks)
    risk_level = "low" if allowed else risk_level_for_confidence(confidence)
    matched_patterns = sorted(aggregated_evidence.keys())
    highest_risk_chunk = max(malicious_chunks, key=lambda chunk: chunk.confidence) if malicious_chunks else chunk_results[0]

    if allowed:
        summary_reason = "No suspicious instruction override or data exfiltration pattern detected."
        final_rationale = "The input is safe because no chunk crossed the malicious threshold."
    else:
        detection_type = "Indirect prompt injection" if source == "webpage_content" else "Prompt injection"
        summary_reason = f"{detection_type} indicators detected in {len(malicious_chunks)} chunk(s): {', '.join(matched_patterns)}."
        final_rationale = (
            "The input is blocked because one or more chunks crossed the malicious threshold "
            "with matched prompt injection indicators."
        )

    analysis_details = AnalysisDetails(
        classifier_mode=prompt_classifier.classifier_mode,
        threshold_used=settings.CLASSIFIER_THRESHOLD,
        preprocessing=preprocessing,
        chunking=ChunkingInfo(
            chunk_count=len(chunks),
            chunk_size=chunk_size,
            overlap=overlap,
            highest_risk_chunk_id=highest_risk_chunk.chunk_id,
        ),
        feature_evidence=FeatureEvidence(
            **feature_explanation_service.extract_features(normalized_prompt, aggregated_evidence)
        ),
        chunk_results=chunk_results,
        final_rationale=final_rationale,
    )

    response = SecurityCheckResponse(
        allowed=allowed,
        label=label,
        confidence=confidence,
        risk_level=risk_level,
        summary_reason=summary_reason,
        matched_patterns=matched_patterns,
        source=source,
        timestamp=datetime.now(timezone.utc).isoformat(),
        analysis_details=analysis_details,
    )

    security_event_store.add_event(
        allowed=response.allowed,
        label=response.label,
        source=response.source,
        summary_reason=response.summary_reason,
    )
    return response


@router.post("/security/check-prompt", response_model=SecurityCheckResponse)
def check_prompt(request: PromptCheckRequest):
    if not request.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt content cannot be empty.")

    return analyze_text(request.prompt, "direct_prompt")


@router.post("/security/check-webpage", response_model=SecurityCheckResponse)
def check_webpage(request: WebpageCheckRequest):
    combined_webpage_content = "\n".join(
        [
            f"Title: {request.page_title}",
            f"URL: {request.url}",
            f"Visible Content: {request.visible_text}",
            f"Hidden Elements: {request.hidden_text}",
            f"HTML Comments: {request.html_comments}",
            f"Meta Tags: {request.meta_tags}",
            f"Input Fields: {request.input_values}",
        ]
    )

    if not combined_webpage_content.strip():
        raise HTTPException(status_code=400, detail="Webpage content cannot be empty.")

    return analyze_text(combined_webpage_content, "webpage_content")


@router.get("/security/events")
def get_security_events():
    return security_event_store.get_events()
