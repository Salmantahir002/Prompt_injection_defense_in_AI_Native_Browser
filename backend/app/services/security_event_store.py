import uuid
from collections import deque
from datetime import datetime, timezone
from typing import List, Dict, Any


class SecurityEventStore:
    """
    In-memory storage for logging historical prompt validation events.
    Thread-safe and capped at the latest 50 events.
    """

    def __init__(self, max_size: int = 50):
        self._events = deque(maxlen=max_size)

    def add_event(self, allowed: bool, label: str, source: str, summary_reason: str) -> Dict[str, Any]:
        """
        Constructs and appends a new security event to the store.
        """
        event = {
            "id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "allowed": allowed,
            "label": label,
            "source": source,
            "summary_reason": summary_reason,
        }
        self._events.append(event)
        return event

    def get_events(self) -> List[Dict[str, Any]]:
        """
        Returns recent events with newest first.
        """
        return list(reversed(self._events))


# Export a singleton instance
security_event_store = SecurityEventStore()
