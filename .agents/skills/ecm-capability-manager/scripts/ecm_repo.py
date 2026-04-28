#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

LIFECYCLE_STATUSES = {"Draft", "Active", "Deprecated", "Retired"}
CAPABILITY_ACTIONS = {
    "create",
    "update",
    "move",
    "retire",
    "delete",
    "merge",
    "promote",
    "demote",
}
CAPABILITY_FIELDS = {
    "_t",
    "schema_version",
    "id",
    "name",
    "aliases",
    "description",
    "domain",
    "type",
    "parent_id",
    "order",
    "lifecycle_status",
    "effective_from",
    "effective_to",
    "rationale",
    "source_references",
    "tags",
    "steward_id",
    "steward_department",
    "replacement_capability_id",
    "created_at",
    "updated_at",
}
EVENT_JSONL_FILES = [
    "ecm/capability_versions.jsonl",
    "ecm/model_versions.jsonl",
    "ecm/publish_events.jsonl",
]
REFERENCE_JSONL_FILES = [
    "ecm/mappings.jsonl",
    "ecm/downstream_consumers.jsonl",
    "ecm/change_requests.jsonl",
    "ecm/tasks.jsonl",
]
ALL_JSONL_FILES = [
    "ecm/capabilities.jsonl",
    *EVENT_JSONL_FILES,
    *REFERENCE_JSONL_FILES,
]
RELEASE_VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
TOKEN_RE = re.compile(r"[a-z0-9]+")


@dataclass(frozen=True)
class Diagnostic:
    code: str
    message: str
    severity: str = "error"
    path: str | None = None
    line: int | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "code": self.code,
            "message": self.message,
            "severity": self.severity,
            "path": self.path,
            "line": self.line,
        }


class ECMError(Exception):
    def __init__(self, code: str, message: str, detail: object | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail

    def to_dict(self) -> dict[str, object]:
        return {"code": self.code, "message": self.message, "detail": self.detail}


class ValidationFailed(ECMError):
    def __init__(self, message: str, detail: object | None = None) -> None:
        super().__init__("VALIDATION_FAILED", message, detail)


class JsonlParseFailed(ECMError):
    def __init__(self, detail: object) -> None:
        super().__init__("JSONL_PARSE_FAILED", "JSONL parse or validation failed.", detail)


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def new_id() -> str:
    return str(uuid4())


def normalize_name(name: str) -> str:
    return " ".join(name.strip().lower().split())


def serialize_jsonl(records: list[dict[str, object]]) -> str:
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


def write_jsonl(path: Path, records: list[dict[str, object]]) -> None:
    atomic_write_text(path, serialize_jsonl(records))


def append_jsonl_record(path: Path, record: dict[str, object]) -> None:
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    if existing and not existing.endswith("\n"):
        existing += "\n"
    atomic_write_text(path, existing + serialize_jsonl([record]))


def workspace_paths(root: Path) -> dict[str, Path]:
    return {
        "root": root,
        "config": root / "ecm-studio.json",
        "ecm_dir": root / "ecm",
        "capabilities": root / "ecm" / "capabilities.jsonl",
        "audit": root / "ecm" / "capability_versions.jsonl",
    }


def require_workspace(root: Path) -> dict[str, Path]:
    paths = workspace_paths(root.resolve())
    if not paths["config"].exists() or not paths["ecm_dir"].exists():
        raise ValidationFailed(f'"{root}" is not an ECM workspace.')
    return paths


def read_raw_jsonl(path: Path) -> tuple[list[dict[str, object]], list[Diagnostic], list[int]]:
    if not path.exists():
        return [], [], []
    records: list[dict[str, object]] = []
    lines: list[int] = []
    diagnostics: list[Diagnostic] = []
    for index, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            raw = json.loads(line)
        except json.JSONDecodeError as exc:
            diagnostics.append(
                Diagnostic(
                    code="JSONL_PARSE_FAILED",
                    message=f"JSON parse error: {exc.msg}",
                    path=str(path),
                    line=index,
                )
            )
            continue
        if not isinstance(raw, dict):
            diagnostics.append(
                Diagnostic(
                    code="JSONL_RECORD_INVALID",
                    message="JSONL record must be an object.",
                    path=str(path),
                    line=index,
                )
            )
            continue
        records.append(raw)
        lines.append(index)
    return records, diagnostics, lines


def _str_value(raw: dict[str, object], key: str, default: str = "") -> str:
    value = raw.get(key, default)
    if value is None:
        return default
    if not isinstance(value, str):
        raise ValidationFailed(f'Field "{key}" must be a string.')
    return value


def _optional_str_value(raw: dict[str, object], key: str) -> str | None:
    value = raw.get(key)
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValidationFailed(f'Field "{key}" must be a string or null.')
    return value


def _list_value(raw: dict[str, object], key: str) -> list[str]:
    value = raw.get(key, [])
    if value in (None, ""):
        return []
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ValidationFailed(f'Field "{key}" must be an array of strings.')
    return [item for item in value]


def normalize_capability(raw: dict[str, object]) -> dict[str, object]:
    unknown = sorted(set(raw) - CAPABILITY_FIELDS)
    if unknown:
        raise ValidationFailed(
            f"Capability contains unsupported field(s): {', '.join(unknown)}."
        )
    schema_version = raw.get("schema_version", "1.0")
    if schema_version != "1.0":
        raise ValidationFailed('Capability field "schema_version" must be "1.0".')
    capability_id = _str_value(raw, "id", "").strip()
    if not capability_id:
        raise ValidationFailed('Capability field "id" is required.')
    name = _str_value(raw, "name", "").strip()
    if not name:
        raise ValidationFailed('Capability field "name" is required.')
    order_value = raw.get("order", 0)
    if isinstance(order_value, bool) or not isinstance(order_value, int) or order_value < 0:
        raise ValidationFailed('Capability field "order" must be a non-negative integer.')
    lifecycle_status = _str_value(raw, "lifecycle_status", "Draft")
    if lifecycle_status not in LIFECYCLE_STATUSES:
        raise ValidationFailed(
            'Capability field "lifecycle_status" must be one of Draft, Active, Deprecated, Retired.'
        )
    type_value = _str_value(raw, "type", "leaf")
    if type_value not in {"leaf", "abstract"}:
        raise ValidationFailed('Capability field "type" must be "leaf" or "abstract".')
    return {
        "_t": "capability",
        "schema_version": "1.0",
        "id": capability_id,
        "name": name,
        "aliases": _list_value(raw, "aliases"),
        "description": _str_value(raw, "description", ""),
        "domain": _str_value(raw, "domain", ""),
        "type": type_value,
        "parent_id": _optional_str_value(raw, "parent_id"),
        "order": order_value,
        "lifecycle_status": lifecycle_status,
        "effective_from": _optional_str_value(raw, "effective_from"),
        "effective_to": _optional_str_value(raw, "effective_to"),
        "rationale": _str_value(raw, "rationale", ""),
        "source_references": _list_value(raw, "source_references"),
        "tags": _list_value(raw, "tags"),
        "steward_id": _str_value(raw, "steward_id", ""),
        "steward_department": _str_value(raw, "steward_department", ""),
        "replacement_capability_id": _optional_str_value(raw, "replacement_capability_id"),
        "created_at": _str_value(raw, "created_at", now_iso()),
        "updated_at": _str_value(raw, "updated_at", now_iso()),
    }


def load_capabilities(root: Path) -> tuple[list[dict[str, object]], list[Diagnostic]]:
    paths = require_workspace(root)
    if not paths["capabilities"].exists():
        return [], [
            Diagnostic(
                code="MISSING_CAPABILITIES_FILE",
                message="ecm/capabilities.jsonl is missing.",
                path=str(paths["capabilities"]),
            )
        ]
    raw_records, parse_diagnostics, lines = read_raw_jsonl(paths["capabilities"])
    capabilities: list[dict[str, object]] = []
    capability_lines: list[int] = []
    diagnostics = [*parse_diagnostics]
    for raw, line in zip(raw_records, lines, strict=True):
        record_type = raw.get("_t")
        if record_type != "capability":
            diagnostics.append(
                Diagnostic(
                    code="JSONL_UNSUPPORTED_RECORD_TYPE",
                    message=f"Unsupported record type: {record_type!r}",
                    path=str(paths["capabilities"]),
                    line=line,
                )
            )
            continue
        try:
            capabilities.append(normalize_capability(raw))
            capability_lines.append(line)
        except ECMError as exc:
            diagnostics.append(
                Diagnostic(
                    code=exc.code,
                    message=exc.message,
                    path=str(paths["capabilities"]),
                    line=line,
                )
            )
    diagnostics.extend(
        validate_capability_set(
            capabilities,
            path=str(paths["capabilities"]),
            line_numbers=capability_lines,
        )
    )
    return with_computed_types(capabilities), diagnostics


def validate_workspace(root: Path) -> tuple[list[dict[str, object]], list[Diagnostic]]:
    paths = require_workspace(root)
    capabilities, diagnostics = load_capabilities(root)
    for relative in EVENT_JSONL_FILES:
        _, event_diagnostics, _ = read_raw_jsonl(paths["root"] / Path(relative))
        diagnostics.extend(event_diagnostics)
    return capabilities, diagnostics


def validate_capability_set(
    capabilities: list[dict[str, object]],
    path: str | None = None,
    line_numbers: list[int] | None = None,
) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    ids: dict[str, int] = {}
    names: dict[str, int] = {}
    by_id = {str(capability["id"]): capability for capability in capabilities}

    def line(index: int) -> int | None:
        if line_numbers is None or index >= len(line_numbers):
            return None
        return line_numbers[index]

    for index, capability in enumerate(capabilities):
        capability_id = str(capability["id"])
        if capability_id in ids:
            diagnostics.append(
                Diagnostic(
                    code="DUPLICATE_ID",
                    message=f'Duplicate capability id "{capability_id}".',
                    path=path,
                    line=line(index),
                )
            )
        ids[capability_id] = index

        normalized = normalize_name(str(capability["name"]))
        if normalized in names:
            diagnostics.append(
                Diagnostic(
                    code="DUPLICATE_NAME",
                    message=f'Duplicate capability name "{capability["name"]}".',
                    path=path,
                    line=line(index),
                )
            )
        names[normalized] = index

        parent_id = capability.get("parent_id")
        if parent_id is not None and str(parent_id) not in by_id:
            diagnostics.append(
                Diagnostic(
                    code="VALIDATION_FAILED",
                    message=f'Parent "{parent_id}" for "{capability["name"]}" does not exist.',
                    path=path,
                    line=line(index),
                )
            )

    for index, capability in enumerate(capabilities):
        seen: set[str] = set()
        current: dict[str, object] | None = capability
        while current is not None:
            current_id = str(current["id"])
            if current_id in seen:
                diagnostics.append(
                    Diagnostic(
                        code="CYCLE_DETECTED",
                        message=f'Capability "{capability["name"]}" participates in a hierarchy cycle.',
                        path=path,
                        line=line(index),
                    )
                )
                break
            seen.add(current_id)
            parent_id = current.get("parent_id")
            current = by_id.get(str(parent_id)) if parent_id else None

    return diagnostics


def capability_by_id(capabilities: list[dict[str, object]]) -> dict[str, dict[str, object]]:
    return {str(capability["id"]): capability for capability in capabilities}


def get_capability(capabilities: list[dict[str, object]], capability_id: str) -> dict[str, object]:
    capability = capability_by_id(capabilities).get(capability_id)
    if capability is None:
        raise ValidationFailed(f'Capability "{capability_id}" does not exist.')
    return capability


def assert_unique_name(
    capabilities: list[dict[str, object]], name: str, exclude_id: str | None = None
) -> None:
    wanted = normalize_name(name)
    for capability in capabilities:
        capability_id = str(capability["id"])
        if capability_id != exclude_id and normalize_name(str(capability["name"])) == wanted:
            raise ECMError("DUPLICATE_NAME", f'Capability name "{name}" already exists.')


def assert_parent_exists(capabilities: list[dict[str, object]], parent_id: str | None) -> None:
    if parent_id is None:
        return
    get_capability(capabilities, parent_id)


def is_descendant(
    capabilities: list[dict[str, object]], maybe_descendant_id: str, ancestor_id: str
) -> bool:
    by_id = capability_by_id(capabilities)
    current = by_id.get(maybe_descendant_id)
    seen: set[str] = set()
    while current is not None and current.get("parent_id") is not None:
        parent_id = str(current["parent_id"])
        if parent_id == ancestor_id:
            return True
        if parent_id in seen:
            raise ECMError("CYCLE_DETECTED", "Move would create a hierarchy cycle.")
        seen.add(parent_id)
        current = by_id.get(parent_id)
    return False


def next_order(capabilities: list[dict[str, object]], parent_id: str | None) -> int:
    sibling_orders = [
        int(capability["order"])
        for capability in capabilities
        if capability.get("parent_id") == parent_id
    ]
    return max(sibling_orders, default=-1) + 1


def with_computed_types(capabilities: list[dict[str, object]]) -> list[dict[str, object]]:
    parent_ids = {
        str(capability["parent_id"])
        for capability in capabilities
        if capability.get("parent_id") is not None
    }
    computed: list[dict[str, object]] = []
    for capability in capabilities:
        updated = dict(capability)
        updated["type"] = "abstract" if str(capability["id"]) in parent_ids else "leaf"
        computed.append(updated)
    return computed


def _ordered_siblings(
    capabilities: list[dict[str, object]],
    parent_id: str | None,
    exclude_id: str | None = None,
) -> list[dict[str, object]]:
    siblings = [
        capability
        for capability in capabilities
        if capability.get("parent_id") == parent_id and str(capability["id"]) != exclude_id
    ]
    return sorted(
        siblings,
        key=lambda item: (
            int(item["order"]),
            normalize_name(str(item["name"])),
            str(item["id"]),
        ),
    )


def _normalize_sibling_order(siblings: list[dict[str, object]]) -> list[dict[str, object]]:
    normalized: list[dict[str, object]] = []
    for index, capability in enumerate(siblings):
        if int(capability["order"]) == index:
            normalized.append(dict(capability))
        else:
            updated = dict(capability)
            updated["order"] = index
            normalized.append(updated)
    return normalized


def replace_capability(
    capabilities: list[dict[str, object]], updated: dict[str, object]
) -> list[dict[str, object]]:
    return [
        dict(updated) if str(capability["id"]) == str(updated["id"]) else dict(capability)
        for capability in capabilities
    ]


def move_capability(
    capabilities: list[dict[str, object]],
    capability_id: str,
    new_parent_id: str | None,
    order: int | None = None,
) -> tuple[list[dict[str, object]], dict[str, object]]:
    capability = dict(get_capability(capabilities, capability_id))
    assert_parent_exists(capabilities, new_parent_id)
    if new_parent_id == capability_id:
        raise ECMError("CYCLE_DETECTED", "Move would create a hierarchy cycle.")
    if new_parent_id is not None and is_descendant(capabilities, new_parent_id, capability_id):
        raise ECMError("CYCLE_DETECTED", "Move would create a hierarchy cycle.")
    current_parent_id = capability.get("parent_id")
    destination_siblings = _ordered_siblings(capabilities, new_parent_id, exclude_id=capability_id)
    destination_index = (
        len(destination_siblings)
        if order is None
        else min(max(0, order), len(destination_siblings))
    )
    moved = dict(capability)
    moved["parent_id"] = new_parent_id
    moved["order"] = destination_index
    moved["updated_at"] = now_iso()

    replacements: dict[str, dict[str, object]] = {}
    if current_parent_id != new_parent_id:
        for sibling in _normalize_sibling_order(
            _ordered_siblings(capabilities, current_parent_id, exclude_id=capability_id)
        ):
            replacements[str(sibling["id"])] = sibling

    destination_with_moved = [dict(item) for item in destination_siblings]
    destination_with_moved.insert(destination_index, moved)
    for sibling in _normalize_sibling_order(destination_with_moved):
        replacements[str(sibling["id"])] = sibling

    moved = replacements[capability_id]
    result = [replacements.get(str(item["id"]), dict(item)) for item in capabilities]
    return result, moved


def retire_capability(
    capabilities: list[dict[str, object]],
    capability_id: str,
    rationale: str,
    replacement_capability_id: str | None = None,
    effective_to: str | None = None,
) -> dict[str, object]:
    rationale = rationale.strip()
    if not rationale:
        raise ValidationFailed("Structural operation rationale is required.")
    capability = dict(get_capability(capabilities, capability_id))
    if replacement_capability_id is not None:
        if replacement_capability_id == capability_id:
            raise ValidationFailed(
                "Replacement capability must be different from the retired capability."
            )
        get_capability(capabilities, replacement_capability_id)
    capability["lifecycle_status"] = "Retired"
    capability["effective_to"] = effective_to or now_iso()
    capability["rationale"] = rationale
    capability["replacement_capability_id"] = replacement_capability_id
    capability["updated_at"] = now_iso()
    return capability


def _remove_capability_and_normalize(
    capabilities: list[dict[str, object]], removed: dict[str, object]
) -> list[dict[str, object]]:
    remaining = [dict(item) for item in capabilities if str(item["id"]) != str(removed["id"])]
    replacements = {
        str(sibling["id"]): sibling
        for sibling in _normalize_sibling_order(
            _ordered_siblings(remaining, removed.get("parent_id"))
        )
    }
    return [replacements.get(str(item["id"]), item) for item in remaining]


def delete_capability(
    capabilities: list[dict[str, object]], capability_id: str
) -> tuple[list[dict[str, object]], dict[str, object]]:
    capability = dict(get_capability(capabilities, capability_id))
    if capability.get("lifecycle_status") != "Draft":
        raise ValidationFailed("Only Draft leaf capabilities can be deleted.")
    if any(item.get("parent_id") == capability_id for item in capabilities):
        raise ValidationFailed("Only Draft leaf capabilities can be deleted.")
    return _remove_capability_and_normalize(capabilities, capability), capability


def _merged_aliases(survivor: dict[str, object], source: dict[str, object]) -> list[str]:
    aliases: list[str] = []
    seen = {normalize_name(str(survivor["name"]))}
    for alias in [
        *list(survivor.get("aliases", [])),
        str(source["name"]),
        *list(source.get("aliases", [])),
    ]:
        trimmed = alias.strip()
        if not trimmed:
            continue
        normalized = normalize_name(trimmed)
        if normalized in seen:
            continue
        seen.add(normalized)
        aliases.append(trimmed)
    return aliases


def merge_capabilities(
    capabilities: list[dict[str, object]],
    source_id: str,
    survivor_id: str,
    rationale: str,
    effective_to: str | None = None,
) -> tuple[list[dict[str, object]], dict[str, object], dict[str, object] | None, dict[str, object], bool]:
    rationale = rationale.strip()
    if not rationale:
        raise ValidationFailed("Structural operation rationale is required.")
    if source_id == survivor_id:
        raise ValidationFailed("Source and survivor capabilities must be different.")
    source = dict(get_capability(capabilities, source_id))
    survivor = dict(get_capability(capabilities, survivor_id))
    if is_descendant(capabilities, survivor_id, source_id):
        raise ValidationFailed("Survivor capability cannot be a descendant of the source capability.")

    updated_survivor = dict(survivor)
    updated_survivor["aliases"] = _merged_aliases(survivor, source)
    updated_survivor["updated_at"] = now_iso()
    working = replace_capability(capabilities, updated_survivor)

    for child in _ordered_siblings(working, source_id):
        working, _ = move_capability(working, str(child["id"]), survivor_id)

    working = with_computed_types(working)
    source_removed = source.get("lifecycle_status") == "Draft"
    source_after: dict[str, object] | None = None
    if source_removed:
        working = _remove_capability_and_normalize(working, source)
    else:
        source_after = retire_capability(
            working,
            source_id,
            rationale,
            replacement_capability_id=survivor_id,
            effective_to=effective_to,
        )
        working = replace_capability(working, source_after)

    working = with_computed_types(working)
    survivor_after = dict(get_capability(working, survivor_id))
    if source_after is not None:
        source_after = dict(get_capability(working, source_id))
    return working, source, source_after, survivor_after, source_removed


def sort_capabilities_depth_first(capabilities: list[dict[str, object]]) -> list[dict[str, object]]:
    by_parent: dict[str | None, list[dict[str, object]]] = defaultdict(list)
    all_ids = {str(capability["id"]) for capability in capabilities}
    for capability in capabilities:
        parent_id = capability.get("parent_id")
        normalized_parent = str(parent_id) if str(parent_id) in all_ids else None
        by_parent[normalized_parent].append(dict(capability))
    for siblings in by_parent.values():
        siblings.sort(
            key=lambda item: (
                int(item["order"]),
                normalize_name(str(item["name"])),
                str(item["id"]),
            )
        )

    result: list[dict[str, object]] = []
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(parent_id: str | None) -> None:
        for capability in by_parent.get(parent_id, []):
            capability_id = str(capability["id"])
            if capability_id in visiting:
                raise ECMError("CYCLE_DETECTED", "Move would create a hierarchy cycle.")
            if capability_id in visited:
                continue
            visiting.add(capability_id)
            result.append(dict(capability))
            visit(capability_id)
            visiting.remove(capability_id)
            visited.add(capability_id)

    visit(None)
    for capability in sorted(capabilities, key=lambda item: str(item["id"])):
        capability_id = str(capability["id"])
        if capability_id not in visited:
            parent_id = capability.get("parent_id")
            visit(str(parent_id) if parent_id in all_ids else None)
    return result


def capability_path(capabilities: list[dict[str, object]], capability_id: str) -> list[dict[str, object]]:
    by_id = capability_by_id(capabilities)
    current = by_id.get(capability_id)
    if current is None:
        raise ValidationFailed(f'Capability "{capability_id}" does not exist.')
    path: list[dict[str, object]] = []
    seen: set[str] = set()
    while current is not None:
        current_id = str(current["id"])
        if current_id in seen:
            raise ECMError("CYCLE_DETECTED", "Move would create a hierarchy cycle.")
        path.append(dict(current))
        seen.add(current_id)
        parent_id = current.get("parent_id")
        current = by_id.get(str(parent_id)) if parent_id else None
    path.reverse()
    return path


def save_capabilities(root: Path, capabilities: list[dict[str, object]]) -> None:
    paths = require_workspace(root)
    ordered = sort_capabilities_depth_first(with_computed_types(capabilities))
    write_jsonl(paths["capabilities"], ordered)


def build_capability_event(
    capability_id: str,
    action: str,
    summary: str,
    before: object | None,
    after: object | None,
    patch: dict[str, object],
) -> dict[str, object]:
    if action not in CAPABILITY_ACTIONS:
        raise ValidationFailed(f'Unsupported capability action "{action}".')
    timestamp = now_iso()
    return {
        "_t": "capability_version",
        "schema_version": "1.0",
        "id": new_id(),
        "capability_id": capability_id,
        "action": action,
        "summary": summary,
        "before": before,
        "after": after,
        "patch": patch,
        "actor": "local",
        "created_at": timestamp,
        "updated_at": timestamp,
    }


def type_transition_events(
    before_capabilities: list[dict[str, object]],
    after_capabilities: list[dict[str, object]],
    trigger: str,
) -> list[dict[str, object]]:
    before_by_id = {
        str(capability["id"]): capability for capability in with_computed_types(before_capabilities)
    }
    after_by_id = {
        str(capability["id"]): capability for capability in with_computed_types(after_capabilities)
    }
    events: list[dict[str, object]] = []
    for capability_id in sorted(set(before_by_id) & set(after_by_id)):
        before = before_by_id[capability_id]
        after = after_by_id[capability_id]
        if before["type"] == after["type"]:
            continue
        action = "promote" if after["type"] == "abstract" else "demote"
        target = "abstract" if action == "promote" else "leaf"
        events.append(
            build_capability_event(
                capability_id=capability_id,
                action=action,
                summary=f'{action.title()}d capability "{after["name"]}" to {target}.',
                before=before,
                after=after,
                patch={"type": after["type"], "trigger": trigger},
            )
        )
    return events


def append_events(root: Path, events: list[dict[str, object]]) -> None:
    paths = require_workspace(root)
    for event in events:
        append_jsonl_record(paths["audit"], event)


def read_json_file(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValidationFailed(f'File "{path}" does not exist.') from exc
    except json.JSONDecodeError as exc:
        raise ValidationFailed(f'JSON parse error in "{path}": {exc.msg}') from exc


def read_jsonl_records(root: Path, relative: str) -> tuple[list[dict[str, object]], list[Diagnostic], list[int]]:
    paths = require_workspace(root)
    return read_raw_jsonl(paths["root"] / Path(relative))


def parse_capabilities_text(content: str, path: str) -> tuple[list[dict[str, object]], list[Diagnostic]]:
    records: list[dict[str, object]] = []
    diagnostics: list[Diagnostic] = []
    lines: list[int] = []
    for index, line in enumerate(content.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            raw = json.loads(line)
        except json.JSONDecodeError as exc:
            diagnostics.append(
                Diagnostic("JSONL_PARSE_FAILED", f"JSON parse error: {exc.msg}", path=path, line=index)
            )
            continue
        if not isinstance(raw, dict) or raw.get("_t") != "capability":
            diagnostics.append(
                Diagnostic("JSONL_UNSUPPORTED_RECORD_TYPE", "Expected capability record.", path=path, line=index)
            )
            continue
        try:
            records.append(normalize_capability(raw))
            lines.append(index)
        except ECMError as exc:
            diagnostics.append(Diagnostic(exc.code, exc.message, path=path, line=index))
    diagnostics.extend(validate_capability_set(records, path=path, line_numbers=lines))
    return with_computed_types(records), diagnostics


def children_by_parent(capabilities: list[dict[str, object]]) -> dict[str | None, list[dict[str, object]]]:
    children: dict[str | None, list[dict[str, object]]] = defaultdict(list)
    for capability in capabilities:
        children[capability.get("parent_id")].append(capability)
    for siblings in children.values():
        siblings.sort(key=lambda item: (int(item["order"]), normalize_name(str(item["name"])), str(item["id"])))
    return children


def capability_depths(capabilities: list[dict[str, object]]) -> dict[str, int]:
    by_id = capability_by_id(capabilities)
    depths: dict[str, int] = {}
    for capability in capabilities:
        depth = 0
        current = capability
        seen: set[str] = set()
        while current.get("parent_id"):
            parent_id = str(current["parent_id"])
            if parent_id in seen:
                break
            seen.add(parent_id)
            parent = by_id.get(parent_id)
            if parent is None:
                break
            depth += 1
            current = parent
        depths[str(capability["id"])] = depth
    return depths


def descendant_ids(capabilities: list[dict[str, object]], capability_id: str) -> list[str]:
    children = children_by_parent(capabilities)
    result: list[str] = []

    def visit(parent_id: str) -> None:
        for child in children.get(parent_id, []):
            child_id = str(child["id"])
            result.append(child_id)
            visit(child_id)

    visit(capability_id)
    return result


def compact_name_key(name: str) -> str:
    stop_words = {"and", "of", "the", "for", "capability", "capabilities"}
    tokens = [token for token in TOKEN_RE.findall(name.lower()) if token not in stop_words]
    return " ".join(tokens)


def slugify(value: str) -> str:
    slug = "-".join(TOKEN_RE.findall(value.lower()))
    return slug or "capability"


def split_multi(value: object, separator: str = ";") -> list[str]:
    if value is None:
        return []
    raw = str(value).replace(",", separator)
    return [item.strip() for item in raw.split(separator) if item.strip()]


def normalize_import_order(capabilities: list[dict[str, object]]) -> list[dict[str, object]]:
    normalized = [dict(item) for item in capabilities]
    by_parent = children_by_parent(normalized)
    replacements: dict[str, dict[str, object]] = {}
    for siblings in by_parent.values():
        for index, sibling in enumerate(siblings):
            updated = dict(sibling)
            updated["order"] = index
            replacements[str(updated["id"])] = updated
    return [replacements.get(str(item["id"]), item) for item in normalized]


def capability_csv_row(capability: dict[str, object]) -> dict[str, object]:
    return {
        "id": capability["id"],
        "name": capability["name"],
        "parent_id": capability.get("parent_id") or "",
        "order": capability["order"],
        "domain": capability.get("domain") or "",
        "type": capability.get("type") or "leaf",
        "lifecycle_status": capability.get("lifecycle_status") or "Draft",
        "description": capability.get("description") or "",
        "aliases": ";".join(capability.get("aliases", [])),
        "tags": ";".join(capability.get("tags", [])),
        "steward_id": capability.get("steward_id") or "",
        "steward_department": capability.get("steward_department") or "",
        "replacement_capability_id": capability.get("replacement_capability_id") or "",
    }


def write_capability_export(path: Path, format_name: str, capabilities: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if format_name == "jsonl":
        write_jsonl(path, [dict(item) for item in capabilities])
        return
    if format_name == "json_bundle":
        bundle = {
            "_t": "ecm_model_bundle",
            "schema_version": "1.0",
            "exported_at": now_iso(),
            "capabilities": [dict(item) for item in capabilities],
        }
        atomic_write_text(path, json.dumps(bundle, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
        return
    if format_name == "csv":
        fieldnames = list(capability_csv_row(capabilities[0] if capabilities else {
            "id": "",
            "name": "",
            "order": 0,
        }).keys())
        tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        with tmp.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for capability in capabilities:
                writer.writerow(capability_csv_row(capability))
        try:
            os.replace(tmp, path)
        finally:
            if tmp.exists():
                tmp.unlink()
        return
    raise ValidationFailed("Import map format must be jsonl, csv, or json_bundle.")


def run_git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=root,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )


def git_summary(root: Path) -> dict[str, object]:
    is_repo = run_git(root, "rev-parse", "--is-inside-work-tree").returncode == 0
    if not is_repo:
        return {"is_repo": False}
    branch = run_git(root, "branch", "--show-current").stdout.strip() or None
    status = run_git(root, "status", "--porcelain=v1").stdout.splitlines()
    remote = run_git(root, "remote").stdout.strip().splitlines()
    upstream_result = run_git(root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    upstream = upstream_result.stdout.strip() if upstream_result.returncode == 0 else None
    ahead = behind = 0
    if upstream:
        counts = run_git(root, "rev-list", "--left-right", "--count", "HEAD...@{u}")
        parts = counts.stdout.split()
        if len(parts) == 2:
            ahead, behind = int(parts[0]), int(parts[1])
    return {
        "is_repo": True,
        "branch": branch,
        "clean": not status,
        "changed_files": [line[3:] for line in status if line and not line.startswith("??")],
        "untracked_files": [line[3:] for line in status if line.startswith("??")],
        "has_remote": bool(remote),
        "remotes": remote,
        "upstream": upstream,
        "ahead": ahead,
        "behind": behind,
    }


def git_tag_exists(root: Path, tag: str) -> bool:
    return run_git(root, "rev-parse", "-q", "--verify", f"refs/tags/{tag}").returncode == 0


def json_contains_string(value: object, target: str) -> bool:
    if isinstance(value, str):
        return value == target or target in value
    if isinstance(value, list):
        return any(json_contains_string(item, target) for item in value)
    if isinstance(value, dict):
        return any(json_contains_string(item, target) for item in value.values())
    return False


def action_counts(records: list[dict[str, object]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for record in records:
        action = str(record.get("action") or record.get("event_type") or "unknown")
        counts[action] = counts.get(action, 0) + 1
    return dict(sorted(counts.items()))


def add_common_cli_args(command: list[str], values: dict[str, object], include_id: bool = False) -> None:
    scalar_flags = {
        "id": "--id",
        "name": "--name",
        "description": "--description",
        "domain": "--domain",
        "lifecycle_status": "--lifecycle-status",
        "effective_from": "--effective-from",
        "effective_to": "--effective-to",
        "rationale": "--rationale",
        "steward_id": "--steward-id",
        "steward_department": "--steward-department",
        "replacement_capability_id": "--replacement-capability-id",
    }
    for field, flag in scalar_flags.items():
        if field == "id" and not include_id:
            continue
        value = values.get(field)
        if value not in (None, ""):
            command.extend([flag, str(value)])
    repeated_flags = {
        "aliases": "--alias",
        "tags": "--tag",
        "source_references": "--source-reference",
    }
    for field, flag in repeated_flags.items():
        value = values.get(field)
        if isinstance(value, list):
            for item in value:
                if str(item).strip():
                    command.extend([flag, str(item)])


def output_result(payload: dict[str, object], as_json: bool = True) -> int:
    if as_json:
        print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        print(payload)
    return 0


def fail(exc: ECMError) -> int:
    print(json.dumps({"ok": False, "error": exc.to_dict()}, ensure_ascii=False, indent=2))
    return 1


def fail_diagnostics(diagnostics: list[Diagnostic]) -> int:
    error_count = sum(1 for item in diagnostics if item.severity == "error")
    output_result(
        {
            "ok": error_count == 0,
            "diagnostics": [diagnostic.to_dict() for diagnostic in diagnostics],
            "error_count": error_count,
        }
    )
    return 1 if error_count else 0


def _apply_common_create_fields(args: argparse.Namespace) -> dict[str, object]:
    return {
        "_t": "capability",
        "schema_version": "1.0",
        "id": args.capability_id or new_id(),
        "name": args.name.strip(),
        "parent_id": args.parent_id,
        "aliases": [alias.strip() for alias in args.alias or [] if alias.strip()],
        "description": args.description or "",
        "domain": args.domain or "",
        "type": "leaf",
        "lifecycle_status": args.lifecycle_status,
        "effective_from": args.effective_from,
        "effective_to": args.effective_to,
        "rationale": args.rationale or "",
        "source_references": [
            reference.strip() for reference in args.source_reference or [] if reference.strip()
        ],
        "tags": [tag.strip() for tag in args.tag or [] if tag.strip()],
        "steward_id": args.steward_id or "",
        "steward_department": args.steward_department or "",
        "replacement_capability_id": args.replacement_capability_id,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }


def command_validate(args: argparse.Namespace) -> int:
    try:
        capabilities, diagnostics = validate_workspace(Path(args.workspace))
        if diagnostics:
            return fail_diagnostics(diagnostics)
        return output_result({"ok": True, "count": len(capabilities), "diagnostics": []})
    except ECMError as exc:
        return fail(exc)


def command_list(args: argparse.Namespace) -> int:
    try:
        capabilities, diagnostics = load_capabilities(Path(args.workspace))
        if diagnostics:
            return fail_diagnostics(diagnostics)
        items = []
        for capability in sort_capabilities_depth_first(capabilities):
            capability_id = str(capability["id"])
            if args.capability_id and capability_id != args.capability_id:
                continue
            if args.name and args.name.lower() not in str(capability["name"]).lower():
                continue
            path = " / ".join(item["name"] for item in capability_path(capabilities, capability_id))
            items.append(
                {
                    "id": capability_id,
                    "name": capability["name"],
                    "path": path,
                    "parent_id": capability.get("parent_id"),
                    "order": capability["order"],
                    "type": capability["type"],
                    "lifecycle_status": capability["lifecycle_status"],
                    "replacement_capability_id": capability.get("replacement_capability_id"),
                }
            )
        return output_result({"ok": True, "count": len(items), "capabilities": items})
    except ECMError as exc:
        return fail(exc)


def command_create(args: argparse.Namespace) -> int:
    try:
        root = Path(args.workspace)
        capabilities, diagnostics = load_capabilities(root)
        if diagnostics:
            return fail_diagnostics(diagnostics)
        before_capabilities = deepcopy(capabilities)
        assert_parent_exists(capabilities, args.parent_id)
        if not args.name.strip():
            raise ValidationFailed("Capability name is required.")
        assert_unique_name(capabilities, args.name.strip())
        capability = _apply_common_create_fields(args)
        capability["order"] = next_order(capabilities, args.parent_id)
        capabilities.append(capability)
        after_capabilities = with_computed_types(capabilities)
        created = dict(get_capability(after_capabilities, str(capability["id"])))
        save_capabilities(root, after_capabilities)
        events = [
            build_capability_event(
                capability_id=str(created["id"]),
                action="create",
                summary=f'Created capability "{created["name"]}".',
                before=None,
                after=created,
                patch={
                    key: value
                    for key, value in capability.items()
                    if key not in {"created_at", "updated_at", "_t", "schema_version", "order"}
                },
            ),
            *type_transition_events(before_capabilities, after_capabilities, "create"),
        ]
        append_events(root, events)
        return output_result({"ok": True, "operation": "create", "capability": created})
    except ECMError as exc:
        return fail(exc)


def command_update(args: argparse.Namespace) -> int:
    try:
        root = Path(args.workspace)
        capabilities, diagnostics = load_capabilities(root)
        if diagnostics:
            return fail_diagnostics(diagnostics)
        before_capabilities = deepcopy(capabilities)
        before = dict(get_capability(capabilities, args.capability_id))
        updated = dict(before)
        patch: dict[str, object] = {}
        if args.name is not None:
            name = args.name.strip()
            if not name:
                raise ValidationFailed("Capability name is required.")
            assert_unique_name(capabilities, name, exclude_id=args.capability_id)
            updated["name"] = name
            patch["name"] = name
        scalar_fields = [
            "description",
            "domain",
            "lifecycle_status",
            "effective_from",
            "effective_to",
            "rationale",
            "steward_id",
            "steward_department",
        ]
        for field in scalar_fields:
            value = getattr(args, field)
            if value is not None:
                updated[field] = value
                patch[field] = value
        if args.replacement_capability_id is not None:
            if args.replacement_capability_id:
                if args.replacement_capability_id == args.capability_id:
                    raise ValidationFailed(
                        "Replacement capability must be different from the capability being updated."
                    )
                get_capability(capabilities, args.replacement_capability_id)
                updated["replacement_capability_id"] = args.replacement_capability_id
                patch["replacement_capability_id"] = args.replacement_capability_id
            else:
                updated["replacement_capability_id"] = None
                patch["replacement_capability_id"] = None
        if args.alias is not None:
            updated["aliases"] = [alias.strip() for alias in args.alias if alias.strip()]
            patch["aliases"] = updated["aliases"]
        elif args.clear_aliases:
            updated["aliases"] = []
            patch["aliases"] = []
        if args.tag is not None:
            updated["tags"] = [tag.strip() for tag in args.tag if tag.strip()]
            patch["tags"] = updated["tags"]
        elif args.clear_tags:
            updated["tags"] = []
            patch["tags"] = []
        if args.source_reference is not None:
            updated["source_references"] = [
                reference.strip() for reference in args.source_reference if reference.strip()
            ]
            patch["source_references"] = updated["source_references"]
        elif args.clear_source_references:
            updated["source_references"] = []
            patch["source_references"] = []
        if not patch:
            raise ValidationFailed("Provide at least one field to update.")
        updated["updated_at"] = now_iso()
        capabilities = replace_capability(capabilities, updated)
        capabilities = with_computed_types(capabilities)
        result = dict(get_capability(capabilities, args.capability_id))
        save_capabilities(root, capabilities)
        events = [
            build_capability_event(
                capability_id=args.capability_id,
                action="update",
                summary=f'Updated capability "{result["name"]}".',
                before=before,
                after=result,
                patch=patch,
            ),
            *type_transition_events(before_capabilities, capabilities, "update"),
        ]
        append_events(root, events)
        return output_result({"ok": True, "operation": "update", "capability": result})
    except ECMError as exc:
        return fail(exc)


def command_move(args: argparse.Namespace) -> int:
    try:
        root = Path(args.workspace)
        capabilities, diagnostics = load_capabilities(root)
        if diagnostics:
            return fail_diagnostics(diagnostics)
        before_capabilities = deepcopy(capabilities)
        before = dict(get_capability(capabilities, args.capability_id))
        capabilities, moved = move_capability(
            capabilities, args.capability_id, args.parent_id, args.order
        )
        capabilities = with_computed_types(capabilities)
        moved = dict(get_capability(capabilities, str(moved["id"])))
        save_capabilities(root, capabilities)
        events = [
            build_capability_event(
                capability_id=args.capability_id,
                action="move",
                summary=f'Moved capability "{moved["name"]}".',
                before=before,
                after=moved,
                patch={"parent_id": args.parent_id, "order": moved["order"]},
            ),
            *type_transition_events(before_capabilities, capabilities, "move"),
        ]
        append_events(root, events)
        return output_result({"ok": True, "operation": "move", "capability": moved})
    except ECMError as exc:
        return fail(exc)


def command_retire(args: argparse.Namespace) -> int:
    try:
        root = Path(args.workspace)
        capabilities, diagnostics = load_capabilities(root)
        if diagnostics:
            return fail_diagnostics(diagnostics)
        before_capabilities = deepcopy(capabilities)
        before = dict(get_capability(capabilities, args.capability_id))
        retired = retire_capability(
            capabilities,
            args.capability_id,
            args.rationale,
            replacement_capability_id=args.replacement_capability_id,
            effective_to=args.effective_to,
        )
        capabilities = replace_capability(capabilities, retired)
        capabilities = with_computed_types(capabilities)
        retired = dict(get_capability(capabilities, args.capability_id))
        save_capabilities(root, capabilities)
        patch = {
            "rationale": args.rationale,
            "downstream_handling": args.downstream_handling or "",
            "replacement_capability_id": args.replacement_capability_id,
        }
        events = [
            build_capability_event(
                capability_id=args.capability_id,
                action="retire",
                summary=f'Retired capability "{retired["name"]}".',
                before=before,
                after=retired,
                patch=patch,
            ),
            *type_transition_events(before_capabilities, capabilities, "retire"),
        ]
        append_events(root, events)
        return output_result({"ok": True, "operation": "retire", "capability": retired})
    except ECMError as exc:
        return fail(exc)


def command_delete(args: argparse.Namespace) -> int:
    try:
        root = Path(args.workspace)
        capabilities, diagnostics = load_capabilities(root)
        if diagnostics:
            return fail_diagnostics(diagnostics)
        before_capabilities = deepcopy(capabilities)
        capabilities, deleted = delete_capability(capabilities, args.capability_id)
        capabilities = with_computed_types(capabilities)
        save_capabilities(root, capabilities)
        patch = {
            "rationale": args.rationale,
            "downstream_handling": args.downstream_handling or "",
            "replacement_capability_id": None,
        }
        events = [
            build_capability_event(
                capability_id=args.capability_id,
                action="delete",
                summary=f'Deleted draft capability "{deleted["name"]}".',
                before=deleted,
                after=None,
                patch=patch,
            ),
            *type_transition_events(before_capabilities, capabilities, "delete"),
        ]
        append_events(root, events)
        return output_result(
            {
                "ok": True,
                "operation": "delete",
                "deleted_id": deleted["id"],
                "deleted_name": deleted["name"],
            }
        )
    except ECMError as exc:
        return fail(exc)


def command_merge(args: argparse.Namespace) -> int:
    try:
        root = Path(args.workspace)
        capabilities, diagnostics = load_capabilities(root)
        if diagnostics:
            return fail_diagnostics(diagnostics)
        before_capabilities = deepcopy(capabilities)
        source_before = dict(get_capability(capabilities, args.source_id))
        survivor_before = dict(get_capability(capabilities, args.survivor_id))
        (
            capabilities,
            source_before,
            source_after,
            survivor_after,
            source_removed,
        ) = merge_capabilities(
            capabilities,
            args.source_id,
            args.survivor_id,
            args.rationale,
            effective_to=args.effective_to,
        )
        capabilities = with_computed_types(capabilities)
        save_capabilities(root, capabilities)
        patch = {
            "rationale": args.rationale,
            "downstream_handling": args.downstream_handling or "",
            "source_id": args.source_id,
            "survivor_id": args.survivor_id,
            "source_removed": source_removed,
        }
        events = [
            build_capability_event(
                capability_id=args.survivor_id,
                action="merge",
                summary=f'Merged capability "{source_before["name"]}" into "{survivor_after["name"]}".',
                before={"source": source_before, "survivor": survivor_before},
                after={"source": source_after, "survivor": survivor_after},
                patch=patch,
            ),
            *type_transition_events(before_capabilities, capabilities, "merge"),
        ]
        append_events(root, events)
        return output_result(
            {
                "ok": True,
                "operation": "merge",
                "source": source_after,
                "survivor": survivor_after,
                "source_removed": source_removed,
            }
        )
    except ECMError as exc:
        return fail(exc)


def command_import_map(args: argparse.Namespace) -> int:
    try:
        root = Path(args.workspace)
        require_workspace(root)
        source = Path(args.source)
        mapping = read_json_file(Path(args.mapping))
        if not isinstance(mapping, dict):
            raise ValidationFailed("Import mapping must be a JSON object.")
        fields = mapping.get("fields")
        if not isinstance(fields, dict):
            raise ValidationFailed('Import mapping must contain a "fields" object.')
        defaults = mapping.get("defaults", {})
        if not isinstance(defaults, dict):
            raise ValidationFailed('Import mapping "defaults" must be an object when supplied.')
        split_fields = mapping.get("split_fields", {})
        if not isinstance(split_fields, dict):
            raise ValidationFailed('Import mapping "split_fields" must be an object when supplied.')
        id_prefix = str(mapping.get("id_prefix", "cap-"))

        capabilities: list[dict[str, object]] = []
        generated_ids: set[str] = set()
        with source.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            for row_number, row in enumerate(reader, start=2):
                raw: dict[str, object] = {"_t": "capability", "schema_version": "1.0"}
                for field in CAPABILITY_FIELDS - {"_t", "schema_version", "created_at", "updated_at"}:
                    source_column = fields.get(field)
                    value: object = None
                    if isinstance(source_column, str) and source_column in row:
                        value = row.get(source_column)
                    elif field in defaults:
                        value = defaults[field]
                    if field in {"aliases", "tags", "source_references"}:
                        separator = str(split_fields.get(field, ";"))
                        value = split_multi(value, separator)
                    elif isinstance(value, str):
                        value = value.strip()
                    if value not in (None, ""):
                        raw[field] = value
                if "name" not in raw:
                    raise ValidationFailed(f"Mapped row {row_number} does not produce a capability name.")
                if "id" not in raw:
                    base = f"{id_prefix}{slugify(str(raw['name']))}"
                    generated = base
                    suffix = 2
                    while generated in generated_ids:
                        generated = f"{base}-{suffix}"
                        suffix += 1
                    raw["id"] = generated
                generated_ids.add(str(raw["id"]))
                if "order" in raw:
                    try:
                        raw["order"] = int(str(raw["order"]))
                    except ValueError as exc:
                        raise ValidationFailed(f"Mapped row {row_number} has a non-integer order.") from exc
                raw.setdefault("order", 0)
                raw.setdefault("lifecycle_status", "Draft")
                raw.setdefault("created_at", now_iso())
                raw.setdefault("updated_at", now_iso())
                capabilities.append(normalize_capability(raw))

        capabilities = with_computed_types(normalize_import_order(capabilities))
        diagnostics = validate_capability_set(capabilities, path=str(source))
        if diagnostics:
            return fail_diagnostics(diagnostics)
        output_path = Path(args.output)
        write_capability_export(output_path, args.format, capabilities)
        return output_result(
            {
                "ok": True,
                "operation": "import-map",
                "source": str(source),
                "output": str(output_path),
                "format": args.format,
                "count": len(capabilities),
                "diagnostics": [],
            }
        )
    except (OSError, ECMError) as exc:
        if isinstance(exc, ECMError):
            return fail(exc)
        return fail(ValidationFailed(str(exc)))


def command_quality_report(args: argparse.Namespace) -> int:
    try:
        capabilities, diagnostics = load_capabilities(Path(args.workspace))
        if diagnostics:
            return fail_diagnostics(diagnostics)
        children = children_by_parent(capabilities)
        depths = capability_depths(capabilities)
        compact_names: dict[str, list[dict[str, object]]] = defaultdict(list)
        findings: list[dict[str, object]] = []
        for capability in capabilities:
            capability_id = str(capability["id"])
            name = str(capability["name"])
            compact_names[compact_name_key(name)].append(capability)
            if len(str(capability.get("description") or "").strip()) < 20:
                findings.append(
                    {
                        "code": "WEAK_DESCRIPTION",
                        "severity": "warning",
                        "capability_id": capability_id,
                        "name": name,
                        "message": "Description is missing or very short.",
                    }
                )
            if not str(capability.get("domain") or "").strip():
                findings.append({"code": "MISSING_DOMAIN", "severity": "info", "capability_id": capability_id, "name": name})
            if not capability.get("tags"):
                findings.append({"code": "MISSING_TAGS", "severity": "info", "capability_id": capability_id, "name": name})
            if not str(capability.get("steward_id") or "").strip():
                findings.append({"code": "MISSING_STEWARD", "severity": "warning", "capability_id": capability_id, "name": name})
            child_count = len(children.get(capability_id, []))
            if capability.get("type") == "abstract" and child_count == 1:
                findings.append({"code": "THIN_ABSTRACT", "severity": "info", "capability_id": capability_id, "name": name})
            if depths.get(capability_id, 0) > 5:
                findings.append({"code": "DEEP_DECOMPOSITION", "severity": "info", "capability_id": capability_id, "name": name})
            if capability.get("lifecycle_status") == "Retired" and not capability.get("effective_to"):
                findings.append({"code": "RETIRED_WITHOUT_EFFECTIVE_TO", "severity": "warning", "capability_id": capability_id, "name": name})
            if capability.get("lifecycle_status") == "Active" and capability.get("effective_to"):
                findings.append({"code": "ACTIVE_WITH_EFFECTIVE_TO", "severity": "warning", "capability_id": capability_id, "name": name})
        for key, items in compact_names.items():
            if key and len(items) > 1:
                findings.append(
                    {
                        "code": "NEAR_DUPLICATE_NAME",
                        "severity": "warning",
                        "capability_ids": [item["id"] for item in items],
                        "names": [item["name"] for item in items],
                    }
                )
        findings.sort(key=lambda item: (str(item["severity"]), str(item["code"]), str(item.get("name", ""))))
        return output_result(
            {
                "ok": True,
                "report": {
                    "capability_count": len(capabilities),
                    "finding_count": len(findings),
                    "findings": findings,
                },
            }
        )
    except ECMError as exc:
        return fail(exc)


def command_release_readiness(args: argparse.Namespace) -> int:
    try:
        root = Path(args.workspace)
        capabilities, diagnostics = validate_workspace(root)
        blockers = [diagnostic.to_dict() for diagnostic in diagnostics if diagnostic.severity == "error"]
        warnings = [diagnostic.to_dict() for diagnostic in diagnostics if diagnostic.severity != "error"]
        version = args.version.strip()
        tag = f"ecm-v{version}"
        if not RELEASE_VERSION_RE.match(version):
            blockers.append({"code": "RELEASE_INVALID_VERSION", "message": "Version must use X.Y.Z."})
        status = git_summary(root)
        if not status.get("is_repo"):
            blockers.append({"code": "GIT_NOT_INITIALIZED", "message": "Workspace is not a Git repository."})
        else:
            if not status.get("clean"):
                blockers.append({"code": "GIT_WORKTREE_DIRTY", "message": "Working tree is not clean."})
            if not status.get("branch"):
                blockers.append({"code": "RELEASE_DETACHED_HEAD", "message": "Switch to a named branch."})
            if not status.get("has_remote"):
                blockers.append({"code": "RELEASE_REMOTE_MISSING", "message": "Configure a Git remote."})
            if int(status.get("behind", 0)) > 0:
                blockers.append({"code": "RELEASE_INCOMING_CHANGES", "message": "Pull incoming changes first."})
            if RELEASE_VERSION_RE.match(version) and git_tag_exists(root, tag):
                blockers.append({"code": "RELEASE_TAG_EXISTS", "message": f'Release tag "{tag}" already exists.'})
        model_versions, model_diagnostics, _ = read_jsonl_records(root, "ecm/model_versions.jsonl")
        publish_events, publish_diagnostics, _ = read_jsonl_records(root, "ecm/publish_events.jsonl")
        warnings.extend(diagnostic.to_dict() for diagnostic in [*model_diagnostics, *publish_diagnostics])
        releases = [
            record
            for record in model_versions
            if record.get("_t") == "model_version" and record.get("action") == "release"
        ]
        if any(record.get("tag") == tag for record in releases):
            blockers.append({"code": "RELEASE_ALREADY_RECORDED", "message": f'Release "{tag}" is already recorded.'})
        if any(record.get("tag") == tag and record.get("delivery_status") == "success" for record in publish_events):
            blockers.append({"code": "RELEASE_ALREADY_PUBLISHED", "message": f'Release "{tag}" is already published.'})
        capability_events, event_diagnostics, _ = read_jsonl_records(root, "ecm/capability_versions.jsonl")
        warnings.extend(diagnostic.to_dict() for diagnostic in event_diagnostics)
        recent_events = capability_events[-12:]
        notes = [str(event.get("summary") or f"{event.get('action')} {event.get('capability_id')}") for event in recent_events]
        return output_result(
            {
                "ok": not blockers,
                "version": version,
                "tag": tag,
                "capability_count": len(capabilities),
                "git": status,
                "blockers": blockers,
                "warnings": warnings,
                "audit_action_counts": action_counts(capability_events),
                "draft_release_notes": notes,
            }
        )
    except ECMError as exc:
        return fail(exc)


def command_impact(args: argparse.Namespace) -> int:
    try:
        root = Path(args.workspace)
        capabilities, diagnostics = load_capabilities(root)
        if diagnostics:
            return fail_diagnostics(diagnostics)
        target = dict(get_capability(capabilities, args.capability_id))
        descendants = [get_capability(capabilities, item_id) for item_id in descendant_ids(capabilities, args.capability_id)]
        ancestors = capability_path(capabilities, args.capability_id)[:-1]
        replacements = [
            item
            for item in capabilities
            if item.get("replacement_capability_id") == args.capability_id
        ]
        references: list[dict[str, object]] = []
        for relative in [*EVENT_JSONL_FILES, *REFERENCE_JSONL_FILES]:
            records, record_diagnostics, lines = read_jsonl_records(root, relative)
            if record_diagnostics:
                references.extend({"file": relative, "diagnostic": item.to_dict()} for item in record_diagnostics)
            for record, line in zip(records, lines, strict=True):
                if json_contains_string(record, args.capability_id):
                    references.append(
                        {
                            "file": relative,
                            "line": line,
                            "record_type": record.get("_t"),
                            "record_id": record.get("id"),
                            "action": record.get("action") or record.get("event_type"),
                        }
                    )
        return output_result(
            {
                "ok": True,
                "capability": target,
                "ancestors": [{"id": item["id"], "name": item["name"]} for item in ancestors],
                "descendants": [{"id": item["id"], "name": item["name"]} for item in descendants],
                "incoming_replacements": [{"id": item["id"], "name": item["name"]} for item in replacements],
                "references": references,
            }
        )
    except ECMError as exc:
        return fail(exc)


def command_bulk_plan(args: argparse.Namespace) -> int:
    try:
        root = Path(args.workspace)
        capabilities, diagnostics = load_capabilities(root)
        if diagnostics:
            return fail_diagnostics(diagnostics)
        raw = read_json_file(Path(args.changes))
        operations = raw.get("operations") if isinstance(raw, dict) else raw
        if not isinstance(operations, list):
            raise ValidationFailed("Bulk changes must be a JSON array or an object with operations.")
        working = deepcopy(capabilities)
        planned: list[dict[str, object]] = []
        errors: list[dict[str, object]] = []
        script = ".agents\\skills\\ecm-capability-manager\\scripts\\ecm_repo.py"
        for index, operation in enumerate(operations, start=1):
            if not isinstance(operation, dict):
                errors.append({"index": index, "message": "Operation must be an object."})
                continue
            action = str(operation.get("action") or operation.get("op") or "")
            try:
                if action == "create":
                    if not operation.get("id"):
                        raise ValidationFailed("Bulk create requires an explicit id.")
                    capability = normalize_capability(
                        {
                            "_t": "capability",
                            "schema_version": "1.0",
                            "id": str(operation["id"]),
                            "name": str(operation.get("name") or ""),
                            "parent_id": operation.get("parent_id"),
                            "order": next_order(working, operation.get("parent_id")),
                            "lifecycle_status": operation.get("lifecycle_status", "Draft"),
                            "domain": operation.get("domain", ""),
                            "description": operation.get("description", ""),
                            "tags": operation.get("tags", []),
                            "aliases": operation.get("aliases", []),
                            "steward_id": operation.get("steward_id", ""),
                            "steward_department": operation.get("steward_department", ""),
                            "created_at": now_iso(),
                            "updated_at": now_iso(),
                        }
                    )
                    assert_parent_exists(working, capability.get("parent_id"))
                    assert_unique_name(working, str(capability["name"]))
                    working.append(capability)
                    command = ["python", script, "create"]
                    add_common_cli_args(command, capability, include_id=True)
                    if capability.get("parent_id"):
                        command.extend(["--parent-id", str(capability["parent_id"])])
                elif action == "update":
                    capability_id = str(operation.get("id") or "")
                    before = dict(get_capability(working, capability_id))
                    updated = dict(before)
                    for field in CAPABILITY_FIELDS - {"_t", "schema_version", "id", "parent_id", "order", "type", "created_at", "updated_at"}:
                        if field in operation:
                            updated[field] = operation[field]
                    if "name" in operation:
                        assert_unique_name(working, str(operation["name"]), exclude_id=capability_id)
                    updated["updated_at"] = now_iso()
                    working = replace_capability(working, normalize_capability(updated))
                    command = ["python", script, "update", "--id", capability_id]
                    add_common_cli_args(command, operation)
                elif action == "move":
                    capability_id = str(operation.get("id") or "")
                    parent_id = operation.get("parent_id")
                    order = operation.get("order")
                    working, _ = move_capability(working, capability_id, str(parent_id) if parent_id else None, int(order) if order is not None else None)
                    command = ["python", script, "move", "--id", capability_id]
                    if parent_id:
                        command.extend(["--parent-id", str(parent_id)])
                    if order is not None:
                        command.extend(["--order", str(order)])
                elif action == "retire":
                    capability_id = str(operation.get("id") or "")
                    retired = retire_capability(
                        working,
                        capability_id,
                        str(operation.get("rationale") or ""),
                        replacement_capability_id=operation.get("replacement_capability_id"),
                    )
                    working = replace_capability(working, retired)
                    command = ["python", script, "retire", "--id", capability_id, "--rationale", str(operation.get("rationale") or "")]
                    if operation.get("replacement_capability_id"):
                        command.extend(["--replacement-capability-id", str(operation["replacement_capability_id"])])
                    if operation.get("downstream_handling"):
                        command.extend(["--downstream-handling", str(operation["downstream_handling"])])
                elif action == "delete":
                    capability_id = str(operation.get("id") or "")
                    if not str(operation.get("rationale") or "").strip():
                        raise ValidationFailed("Delete requires a rationale.")
                    working, _ = delete_capability(working, capability_id)
                    command = ["python", script, "delete", "--id", capability_id, "--rationale", str(operation.get("rationale"))]
                    if operation.get("downstream_handling"):
                        command.extend(["--downstream-handling", str(operation["downstream_handling"])])
                elif action == "merge":
                    source_id = str(operation.get("source_id") or "")
                    survivor_id = str(operation.get("survivor_id") or "")
                    working, *_ = merge_capabilities(working, source_id, survivor_id, str(operation.get("rationale") or ""))
                    command = ["python", script, "merge", "--source-id", source_id, "--survivor-id", survivor_id, "--rationale", str(operation.get("rationale") or "")]
                    if operation.get("downstream_handling"):
                        command.extend(["--downstream-handling", str(operation["downstream_handling"])])
                else:
                    raise ValidationFailed(f'Unsupported bulk action "{action}".')
                working = with_computed_types(working)
                op_diagnostics = validate_capability_set(working)
                if op_diagnostics:
                    errors.extend({"index": index, **item.to_dict()} for item in op_diagnostics)
                planned.append({"index": index, "action": action, "command": command})
            except ECMError as exc:
                errors.append({"index": index, "code": exc.code, "message": exc.message})
        return output_result({"ok": not errors, "operation_count": len(operations), "plan": planned, "errors": errors})
    except ECMError as exc:
        return fail(exc)


def command_governance_audit(args: argparse.Namespace) -> int:
    try:
        root = Path(args.workspace)
        capabilities, diagnostics = validate_workspace(root)
        findings = [diagnostic.to_dict() for diagnostic in diagnostics]
        capability_events, event_diagnostics, _ = read_jsonl_records(root, "ecm/capability_versions.jsonl")
        findings.extend(diagnostic.to_dict() for diagnostic in event_diagnostics)
        for capability in capabilities:
            capability_id = str(capability["id"])
            if not capability.get("steward_id"):
                findings.append({"code": "MISSING_STEWARD", "severity": "warning", "capability_id": capability_id, "name": capability["name"]})
            if capability.get("lifecycle_status") == "Retired":
                if not capability.get("rationale"):
                    findings.append({"code": "RETIRED_WITHOUT_RATIONALE", "severity": "warning", "capability_id": capability_id, "name": capability["name"]})
                if not capability.get("replacement_capability_id"):
                    findings.append({"code": "RETIRED_WITHOUT_REPLACEMENT", "severity": "info", "capability_id": capability_id, "name": capability["name"]})
        for event in capability_events:
            action = event.get("action")
            if action in {"retire", "delete", "merge"}:
                patch = event.get("patch") if isinstance(event.get("patch"), dict) else {}
                if not str(patch.get("rationale") or "").strip():
                    findings.append({"code": "STRUCTURAL_EVENT_WITHOUT_RATIONALE", "severity": "warning", "event_id": event.get("id"), "action": action})
                if not str(patch.get("downstream_handling") or "").strip():
                    findings.append({"code": "STRUCTURAL_EVENT_WITHOUT_DOWNSTREAM_HANDLING", "severity": "info", "event_id": event.get("id"), "action": action})
        model_versions, _, _ = read_jsonl_records(root, "ecm/model_versions.jsonl")
        publish_events, _, _ = read_jsonl_records(root, "ecm/publish_events.jsonl")
        releases = [item for item in model_versions if item.get("_t") == "model_version" and item.get("action") == "release"]
        if not releases:
            findings.append({"code": "NO_RELEASE_HISTORY", "severity": "info", "message": "No release records found."})
        elif not any(item.get("delivery_status") == "success" for item in publish_events):
            findings.append({"code": "NO_SUCCESSFUL_PUBLISH", "severity": "info", "message": "No successful publish event found."})
        return output_result({"ok": True, "finding_count": len(findings), "findings": findings})
    except ECMError as exc:
        return fail(exc)


def command_diff(args: argparse.Namespace) -> int:
    try:
        root = Path(args.workspace)
        require_workspace(root)
        before_result = run_git(root, "show", f"{args.from_ref}:ecm/capabilities.jsonl")
        after_result = run_git(root, "show", f"{args.to_ref}:ecm/capabilities.jsonl")
        if before_result.returncode != 0:
            raise ValidationFailed(before_result.stderr.strip() or f"Could not read {args.from_ref}.")
        if after_result.returncode != 0:
            raise ValidationFailed(after_result.stderr.strip() or f"Could not read {args.to_ref}.")
        before, before_diagnostics = parse_capabilities_text(before_result.stdout, f"{args.from_ref}:ecm/capabilities.jsonl")
        after, after_diagnostics = parse_capabilities_text(after_result.stdout, f"{args.to_ref}:ecm/capabilities.jsonl")
        if before_diagnostics or after_diagnostics:
            return fail_diagnostics([*before_diagnostics, *after_diagnostics])
        before_by_id = capability_by_id(before)
        after_by_id = capability_by_id(after)
        changes: list[dict[str, object]] = []
        for capability_id in sorted(set(after_by_id) - set(before_by_id)):
            changes.append({"kind": "added", "id": capability_id, "name": after_by_id[capability_id]["name"]})
        for capability_id in sorted(set(before_by_id) - set(after_by_id)):
            changes.append({"kind": "removed", "id": capability_id, "name": before_by_id[capability_id]["name"]})
        metadata_fields = sorted(CAPABILITY_FIELDS - {"_t", "schema_version", "id", "name", "parent_id", "order", "type", "created_at", "updated_at"})
        for capability_id in sorted(set(before_by_id) & set(after_by_id)):
            before_item = before_by_id[capability_id]
            after_item = after_by_id[capability_id]
            if before_item["name"] != after_item["name"]:
                changes.append({"kind": "renamed", "id": capability_id, "before": before_item["name"], "after": after_item["name"]})
            if before_item.get("parent_id") != after_item.get("parent_id") or before_item.get("order") != after_item.get("order"):
                changes.append({"kind": "moved", "id": capability_id, "name": after_item["name"], "before_parent_id": before_item.get("parent_id"), "after_parent_id": after_item.get("parent_id")})
            if before_item.get("type") != after_item.get("type"):
                changes.append({"kind": "type_changed", "id": capability_id, "name": after_item["name"], "before": before_item.get("type"), "after": after_item.get("type")})
            if before_item.get("lifecycle_status") != after_item.get("lifecycle_status"):
                kind = "retired" if after_item.get("lifecycle_status") == "Retired" else "lifecycle_changed"
                changes.append({"kind": kind, "id": capability_id, "name": after_item["name"], "before": before_item.get("lifecycle_status"), "after": after_item.get("lifecycle_status")})
            changed_fields = [field for field in metadata_fields if before_item.get(field) != after_item.get(field)]
            if changed_fields:
                changes.append({"kind": "metadata_changed", "id": capability_id, "name": after_item["name"], "fields": changed_fields})
        counts = action_counts([{"action": change["kind"]} for change in changes])
        return output_result({"ok": True, "from": args.from_ref, "to": args.to_ref, "summary": counts, "changes": changes})
    except ECMError as exc:
        return fail(exc)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ecm_repo.py",
        description="Validate and mutate ECM Studio capability repositories.",
    )
    parser.add_argument("--workspace", default=".", help="Path to the ECM workspace root.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate_parser = subparsers.add_parser("validate", help="Validate the workspace model.")
    validate_parser.set_defaults(func=command_validate)

    list_parser = subparsers.add_parser("list", help="List capabilities with paths.")
    list_parser.add_argument("--name", help="Filter by case-insensitive name substring.")
    list_parser.add_argument("--id", dest="capability_id", help="Filter by exact capability id.")
    list_parser.set_defaults(func=command_list)

    create_parser = subparsers.add_parser("create", help="Create a capability.")
    create_parser.add_argument("--id", dest="capability_id", help="Explicit capability id.")
    create_parser.add_argument("--name", required=True, help="Capability name.")
    create_parser.add_argument("--parent-id", help="Parent capability id.")
    create_parser.add_argument("--alias", action="append", help="Alias value. Repeat as needed.")
    create_parser.add_argument("--description")
    create_parser.add_argument("--domain")
    create_parser.add_argument("--lifecycle-status", default="Draft", choices=sorted(LIFECYCLE_STATUSES))
    create_parser.add_argument("--effective-from")
    create_parser.add_argument("--effective-to")
    create_parser.add_argument("--rationale")
    create_parser.add_argument(
        "--source-reference",
        action="append",
        help="Source reference value. Repeat as needed.",
    )
    create_parser.add_argument("--tag", action="append", help="Tag value. Repeat as needed.")
    create_parser.add_argument("--steward-id")
    create_parser.add_argument("--steward-department")
    create_parser.add_argument("--replacement-capability-id")
    create_parser.set_defaults(func=command_create)

    update_parser = subparsers.add_parser("update", help="Update capability metadata.")
    update_parser.add_argument("--id", dest="capability_id", required=True)
    update_parser.add_argument("--name")
    update_parser.add_argument("--description")
    update_parser.add_argument("--domain")
    update_parser.add_argument("--lifecycle-status", choices=sorted(LIFECYCLE_STATUSES))
    update_parser.add_argument("--effective-from")
    update_parser.add_argument("--effective-to")
    update_parser.add_argument("--rationale")
    update_parser.add_argument("--steward-id")
    update_parser.add_argument("--steward-department")
    update_parser.add_argument(
        "--replacement-capability-id",
        help="Replacement capability id. Pass an empty string to clear it.",
    )
    update_parser.add_argument("--alias", action="append", help="Replace aliases with these values.")
    update_parser.add_argument("--clear-aliases", action="store_true")
    update_parser.add_argument("--tag", action="append", help="Replace tags with these values.")
    update_parser.add_argument("--clear-tags", action="store_true")
    update_parser.add_argument(
        "--source-reference",
        action="append",
        help="Replace source references with these values.",
    )
    update_parser.add_argument("--clear-source-references", action="store_true")
    update_parser.set_defaults(func=command_update)

    move_parser = subparsers.add_parser("move", help="Move or reorder a capability.")
    move_parser.add_argument("--id", dest="capability_id", required=True)
    move_parser.add_argument(
        "--parent-id",
        help="New parent capability id. Omit to move to the top level.",
    )
    move_parser.add_argument("--order", type=int, help="Zero-based sibling order.")
    move_parser.set_defaults(func=command_move)

    retire_parser = subparsers.add_parser("retire", help="Retire a capability.")
    retire_parser.add_argument("--id", dest="capability_id", required=True)
    retire_parser.add_argument("--rationale", required=True)
    retire_parser.add_argument("--replacement-capability-id")
    retire_parser.add_argument("--effective-to")
    retire_parser.add_argument("--downstream-handling")
    retire_parser.set_defaults(func=command_retire)

    delete_parser = subparsers.add_parser("delete", help="Delete a draft leaf capability.")
    delete_parser.add_argument("--id", dest="capability_id", required=True)
    delete_parser.add_argument("--rationale", required=True)
    delete_parser.add_argument("--downstream-handling")
    delete_parser.set_defaults(func=command_delete)

    merge_parser = subparsers.add_parser("merge", help="Merge one capability into another.")
    merge_parser.add_argument("--source-id", required=True)
    merge_parser.add_argument("--survivor-id", required=True)
    merge_parser.add_argument("--rationale", required=True)
    merge_parser.add_argument("--effective-to")
    merge_parser.add_argument("--downstream-handling")
    merge_parser.set_defaults(func=command_merge)

    import_map_parser = subparsers.add_parser("import-map", help="Map CSV to ECM import files.")
    import_map_parser.add_argument("--source", required=True, help="Source CSV path.")
    import_map_parser.add_argument("--mapping", required=True, help="Mapping JSON path.")
    import_map_parser.add_argument("--output", required=True, help="Output import file path.")
    import_map_parser.add_argument(
        "--format",
        required=True,
        choices=["jsonl", "csv", "json_bundle"],
        help="Output format.",
    )
    import_map_parser.set_defaults(func=command_import_map)

    quality_parser = subparsers.add_parser("quality-report", help="Report model quality issues.")
    quality_parser.set_defaults(func=command_quality_report)

    release_parser = subparsers.add_parser(
        "release-readiness",
        help="Check release readiness and draft release notes.",
    )
    release_parser.add_argument("--version", required=True, help="Release version in X.Y.Z form.")
    release_parser.set_defaults(func=command_release_readiness)

    impact_parser = subparsers.add_parser("impact", help="Analyze references to a capability.")
    impact_parser.add_argument("--id", dest="capability_id", required=True)
    impact_parser.set_defaults(func=command_impact)

    bulk_parser = subparsers.add_parser("bulk-plan", help="Validate and plan bulk capability changes.")
    bulk_parser.add_argument("--changes", required=True, help="JSON file with operations.")
    bulk_parser.set_defaults(func=command_bulk_plan)

    governance_parser = subparsers.add_parser(
        "governance-audit",
        help="Report governance and traceability gaps.",
    )
    governance_parser.set_defaults(func=command_governance_audit)

    diff_parser = subparsers.add_parser("diff", help="Summarize capability changes between Git refs.")
    diff_parser.add_argument("--from", dest="from_ref", required=True)
    diff_parser.add_argument("--to", dest="to_ref", required=True)
    diff_parser.set_defaults(func=command_diff)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
