from __future__ import annotations

from pathlib import Path
from typing import Any

from ecm_studio.domain.models import CapabilityEvent, ModelEvent, PublishEvent

from .jsonl import append_jsonl_record, read_raw_jsonl


class EventRepository:
    def __init__(self, path: Path) -> None:
        self.path = path

    def append_capability_event(self, event: CapabilityEvent) -> None:
        append_jsonl_record(self.path, event.durable_dict())

    def append_model_event(self, event: ModelEvent) -> None:
        append_jsonl_record(self.path, event.durable_dict())

    def append_publish_event(self, event: PublishEvent) -> None:
        append_jsonl_record(self.path, event.durable_dict())

    def recent(self, limit: int = 100) -> list[dict[str, Any]]:
        if limit <= 0:
            return []
        result = read_raw_jsonl(self.path)
        records = [
            {"line": line_number, "record": record}
            for record, line_number in zip(result.records, result.record_lines, strict=True)
        ]
        for error in result.errors:
            records.append({"line": error.line, "error": error.to_dict()})
        return records[-limit:]
