from datetime import datetime, timezone
from typing import Dict, List, Sequence, Tuple

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


def excerpt_for_display(text: str, evidence: Sequence[str]) -> str:
    """Return the text around the actual match, rather than a chunk's start."""
    lower_text = text.lower()
    matched_term = next((term for term in evidence if term.lower() in lower_text), "")
    if not matched_term:
        return text[:240] + ("..." if len(text) > 240 else "")

    match_start = lower_text.index(matched_term.lower())
    start = max(0, match_start - 110)
    end = min(len(text), match_start + len(matched_term) + 180)
    prefix = "..." if start else ""
    suffix = "..." if end < len(text) else ""
    return f"{prefix}{text[start:end]}{suffix}"


def chunk_reason(label: str, matched_patterns: List[str], evidence: Sequence[str]) -> str:
    if label == "malicious":
        phrases = ", ".join(f'“{term}”' for term in evidence[:3])
        return f"Matched {', '.join(matched_patterns)} indicator(s): {phrases}."

    return "Chunk does not contain suspicious override, reveal, hidden instruction, or exfiltration intent."


def analyze_text(
    raw_text: str,
    source: str,
    content_sources: Sequence[Tuple[str, str]] | None = None,
) -> SecurityCheckResponse:
    normalized_prompt, preprocessing_data = preprocessing_service.preprocess(raw_text)
    preprocessing = PreprocessingSummary(**preprocessing_data)

    chunk_size = settings.DEFAULT_CHUNK_SIZE
    overlap = settings.DEFAULT_CHUNK_OVERLAP
    sources = content_sources or [("prompt", normalized_prompt)]
    chunks = []
    for source_name, source_text in sources:
        # Keep the original channel text in the result so the report can show
        # the user exactly what was captured. The classifier normalizes its own
        # search text, while aggregate preprocessing remains in the metadata.
        for source_chunk in chunking_service.chunk_text(source_text, chunk_size, overlap):
            chunks.append({
                **source_chunk,
                "chunk_id": f"{source_name}_{source_chunk['chunk_id']}",
                "source": source_name,
            })

    chunk_results: List[ChunkResult] = []
    aggregated_evidence: Dict[str, List[str]] = {}

    for chunk in chunks:
        detector_result = prompt_classifier.classify(chunk["text"])
        label = "malicious" if detector_result["is_malicious"] else "benign"
        confidence = detector_result["confidence"] if label == "malicious" else 0.94
        matched_patterns = detector_result["matched_patterns"]
        matched_evidence = sorted({
            keyword
            for keywords in detector_result["pattern_evidence"].values()
            for keyword in keywords
        })
        chunk_classifier_mode = detector_result.get("classifier_mode", "rule_based_fallback")

        for category, keywords in detector_result["pattern_evidence"].items():
            aggregated_evidence.setdefault(category, [])
            for keyword in keywords:
                if keyword not in aggregated_evidence[category]:
                    aggregated_evidence[category].append(keyword)

        chunk_results.append(
            ChunkResult(
                chunk_id=chunk["chunk_id"],
                source=chunk.get("source", "prompt"),
                label=label,
                confidence=confidence,
                risk_level="low" if label == "benign" else risk_level_for_confidence(confidence),
                matched_patterns=matched_patterns,
                reason=chunk_reason(label, matched_patterns, matched_evidence),
                excerpt=excerpt_for_display(chunk["text"], matched_evidence),
                matched_evidence=matched_evidence,
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
        summary_reason = "No instruction-like prompt injection pattern was detected in the scanned content."
        final_rationale = "All scanned content channels were analyzed without a chunk crossing the malicious threshold."
    else:
        detection_type = "Indirect prompt injection" if source == "webpage_content" else "Prompt injection"
        affected_sources = sorted({chunk.source.replace('_', ' ') for chunk in malicious_chunks})
        summary_reason = (
            f"{detection_type} indicators detected in {len(malicious_chunks)} chunk(s) from "
            f"{', '.join(affected_sources)}: {', '.join(matched_patterns)}."
        )
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


# Channels the manual "Scan Page" button analyses.
#
# `dom_snapshot_content` is deliberately excluded: it is the raw string table
# from DOMSnapshot.captureSnapshot (every tag name, class, attribute value and
# URL, unstructured). Its readable text is already covered by visible_text,
# hidden_text and aria_text, so scanning it adds noise without reach.
#
# The agent scanner keeps its own copy of this list in agent_routes.py — the
# two subsystems stay isolated — but they must agree, or a user would scan a
# page by hand, see "safe", and then watch the agent refuse it. That agreement
# is enforced by test_agent_and_manual_scan_agree.py.
MANUAL_SCAN_CHANNELS = (
    "visible_text",
    "hidden_text",
    "html_comments",
    "meta_tags",
    "input_values",
    "aria_text",
    "iframe_content",
    "shadow_dom_content",
    "inline_javascript",
    "css_content",
    "css_generated_content",
    "network_responses",
    "websocket_messages",
    "service_worker_activity",
)


@router.post("/security/check-webpage", response_model=SecurityCheckResponse)
def check_webpage(request: WebpageCheckRequest):
    # Keep every capture channel separate. This prevents a match in telemetry
    # from being misreported as page text and lets the UI identify its origin.
    content_sources = [(name, getattr(request, name)) for name in MANUAL_SCAN_CHANNELS]
    non_empty_sources = [(name, text) for name, text in content_sources if text.strip()]

    if not non_empty_sources:
        raise HTTPException(status_code=400, detail="Webpage content cannot be empty.")

    combined_webpage_content = "\n".join(text for _, text in non_empty_sources)
    return analyze_text(combined_webpage_content, "webpage_content", non_empty_sources)


@router.get("/security/events")
def get_security_events():
    return security_event_store.get_events()
