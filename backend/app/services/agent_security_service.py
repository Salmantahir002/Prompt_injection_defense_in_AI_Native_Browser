"""
Agent Security Service
======================
Scans a page the autonomous agent is about to interact with.

Reuses the shared detection primitives — `text_chunking_service` and
`prompt_classifier` — but owns its own request lifecycle, aggregation, and
event logging. It shares no code path with `security_routes.analyze_text`, so
the manual "Scan Page" flow cannot be altered by changes made here (and vice
versa).

The agent's threat model differs from the manual scanner's: the manual scan
reports to a human who then decides. This one produces a machine decision that
halts an autonomous process, so it errs toward blocking and reports which
content channel carried the threat.
"""

import logging
from typing import Dict, List, Sequence, Tuple

from app.core.config import settings
from app.services.prompt_classifier_service import prompt_classifier
from app.services.text_chunking_service import chunking_service

logger = logging.getLogger(__name__)


def _risk_level(confidence: float) -> str:
    if confidence >= 0.85:
        return "high"
    if confidence >= settings.CLASSIFIER_THRESHOLD:
        return "medium"
    return "low"


def _excerpt(text: str, evidence: Sequence[str], width: int = 200) -> str:
    lower = text.lower()
    matched = next((term for term in evidence if term.lower() in lower), "")
    if not matched:
        return text[:width] + ("..." if len(text) > width else "")

    start = max(0, lower.index(matched.lower()) - 90)
    end = min(len(text), start + width)
    prefix = "..." if start else ""
    suffix = "..." if end < len(text) else ""
    return f"{prefix}{text[start:end]}{suffix}"


class AgentThreatFinding:
    """One channel of page content that tripped the detector."""

    def __init__(self, source: str, confidence: float, patterns: List[str], evidence: List[str], excerpt: str):
        self.source = source
        self.confidence = confidence
        self.patterns = patterns
        self.evidence = evidence
        self.excerpt = excerpt

    def as_dict(self) -> Dict[str, object]:
        return {
            "source": self.source,
            "confidence": self.confidence,
            "matched_patterns": self.patterns,
            "matched_evidence": self.evidence,
            "excerpt": self.excerpt,
        }


class AgentSecurityService:
    def scan_sources(self, sources: Sequence[Tuple[str, str]]) -> Dict[str, object]:
        """
        Classify each content channel independently.

        Channels are kept separate rather than concatenated so that a hit in,
        say, `html_comments` is not reported as visible page text — the agent
        needs to know an injection was hidden, since that is far stronger
        evidence of hostility than the same words in a visible paragraph.
        """
        chunk_size = settings.DEFAULT_CHUNK_SIZE
        overlap = settings.DEFAULT_CHUNK_OVERLAP

        findings: List[AgentThreatFinding] = []
        aggregated_patterns: List[str] = []
        scanned_chunks = 0

        for source_name, source_text in sources:
            if not source_text or not source_text.strip():
                continue

            for chunk in chunking_service.chunk_text(source_text, chunk_size, overlap):
                scanned_chunks += 1
                result = prompt_classifier.classify(chunk["text"])
                if not result["is_malicious"]:
                    continue

                evidence = sorted({
                    keyword
                    for keywords in result["pattern_evidence"].values()
                    for keyword in keywords
                })
                for pattern in result["matched_patterns"]:
                    if pattern not in aggregated_patterns:
                        aggregated_patterns.append(pattern)

                findings.append(
                    AgentThreatFinding(
                        source=source_name,
                        confidence=float(result["confidence"]),
                        patterns=list(result["matched_patterns"]),
                        evidence=evidence,
                        excerpt=_excerpt(chunk["text"], evidence),
                    )
                )

        allowed = not findings
        confidence = max((finding.confidence for finding in findings), default=0.0)
        blocked_sources = sorted({finding.source for finding in findings})

        if allowed:
            summary = "No prompt injection indicators found in any captured page channel."
        else:
            hidden_channels = [
                source for source in blocked_sources
                if source in {"hidden_text", "html_comments", "meta_tags", "aria_text", "css_generated_content"}
            ]
            emphasis = (
                " The content was hidden from a human reader, which is characteristic of a deliberate attack."
                if hidden_channels else ""
            )
            summary = (
                f"Indirect prompt injection detected in {len(findings)} chunk(s) across "
                f"{', '.join(blocked_sources)}: {', '.join(sorted(aggregated_patterns))}.{emphasis}"
            )

        return {
            "allowed": allowed,
            "risk_level": "low" if allowed else _risk_level(confidence),
            "confidence": confidence if not allowed else 0.0,
            "summary_reason": summary,
            "matched_patterns": sorted(aggregated_patterns),
            "blocked_sources": blocked_sources,
            "findings": [finding.as_dict() for finding in findings],
            "scanned_chunks": scanned_chunks,
            "classifier_mode": prompt_classifier.classifier_mode,
        }


agent_security_service = AgentSecurityService()
