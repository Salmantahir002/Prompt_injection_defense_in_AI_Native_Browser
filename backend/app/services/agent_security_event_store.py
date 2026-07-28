"""
Agent Security Event Store
==========================
Event log for autonomous agent page scans.

Deliberately a separate store from `security_event_store`, which belongs to the
user-initiated "Scan Page" workflow. The two logs must never interleave: a user
reading their manual scan history should not see the agent's per-iteration
scans, and an aborted agent task must be attributable to its own task id.
"""

import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


class AgentSecurityEventStore:
    """In-memory log of agent page scans, capped at the most recent entries."""

    def __init__(self, max_size: int = 100):
        self._events = deque(maxlen=max_size)

    def add_event(
        self,
        task_id: str,
        url: str,
        allowed: bool,
        risk_level: str,
        summary_reason: str,
        blocked_sources: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        event = {
            "id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "task_id": task_id,
            "url": url,
            "allowed": allowed,
            "risk_level": risk_level,
            "summary_reason": summary_reason,
            "blocked_sources": blocked_sources or [],
            "origin": "agent_runtime",
        }
        self._events.append(event)
        return event

    def get_events(self, task_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Newest first, optionally narrowed to a single task."""
        events = list(reversed(self._events))
        if task_id:
            events = [event for event in events if event["task_id"] == task_id]
        return events

    def clear(self) -> None:
        self._events.clear()


agent_security_event_store = AgentSecurityEventStore()
