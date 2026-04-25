from __future__ import annotations

import json
import os
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from pydantic import ValidationError

from ecm_studio.domain.errors import JsonlParseFailed
from ecm_studio.domain.models import Capability


@dataclass(frozen=True)
class JsonlError:
    line: int
    message: str

    def to_dict(self) -> dict:
        return {"line": self.line, "message": self.message}


@dataclass(frozen=True)
class JsonlReadResult:
    records: list[dict]
    errors: list[JsonlError]


def read_raw_jsonl(path: Path) -> JsonlReadResult:
    if not path.exists():
        return JsonlReadResult(records=[], errors=[])
    records: list[dict] = []
    errors: list[JsonlError] = []
    for index, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            raw = json.loads(line)
        except json.JSONDecodeError as exc:
            errors.append(JsonlError(index, f"JSON parse error: {exc.msg}"))
            continue
        if not isinstance(raw, dict):
            errors.append(JsonlError(index, "JSONL record must be an object."))
            continue
        records.append(raw)
    return JsonlReadResult(records=records, errors=errors)


def read_capabilities(path: Path) -> tuple[list[Capability], list[JsonlError]]:
    result = read_raw_jsonl(path)
    capabilities: list[Capability] = []
    errors = list(result.errors)
    for line_offset, raw in enumerate(result.records, start=1):
        if raw.get("_t") != "capability":
            errors.append(JsonlError(line_offset, f"Unsupported record type: {raw.get('_t')!r}"))
            continue
        try:
            capabilities.append(Capability.model_validate(raw))
        except ValidationError as exc:
            errors.append(JsonlError(line_offset, exc.errors()[0].get("msg", str(exc))))
    return capabilities, errors


def serialize_jsonl(records: Iterable[dict]) -> str:
    lines = [
        json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        for record in records
    ]
    return "\n".join(lines) + ("\n" if lines else "")


def atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(content, encoding="utf-8", newline="\n")
    try:
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


def write_jsonl(path: Path, records: Iterable[dict]) -> None:
    atomic_write_text(path, serialize_jsonl(records))


def append_jsonl_record(path: Path, record: dict) -> None:
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    if existing and not existing.endswith("\n"):
        existing += "\n"
    atomic_write_text(path, existing + serialize_jsonl([record]))


def raise_on_errors(errors: list[JsonlError]) -> None:
    if errors:
        raise JsonlParseFailed([error.to_dict() for error in errors])
