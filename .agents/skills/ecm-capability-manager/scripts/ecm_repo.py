#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
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
    raw_records, parse_diagnostics, lines = read_raw_jsonl(paths["capabilities"])
    capabilities: list[dict[str, object]] = []
    capability_lines: list[int] = []
    diagnostics = [*parse_diagnostics]
    for raw, line in zip(raw_records, lines, strict=True):
        record_type = raw.get("_t", "capability")
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
    return output_result(
        {
            "ok": False,
            "diagnostics": [diagnostic.to_dict() for diagnostic in diagnostics],
            "error_count": sum(1 for item in diagnostics if item.severity == "error"),
        }
    )


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
    capabilities, diagnostics = load_capabilities(Path(args.workspace))
    if diagnostics:
        return fail_diagnostics(diagnostics)
    return output_result({"ok": True, "count": len(capabilities), "diagnostics": []})


def command_list(args: argparse.Namespace) -> int:
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

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
