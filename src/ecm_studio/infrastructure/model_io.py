from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from pydantic import ValidationError

from ecm_studio.domain.capabilities import normalize_name, with_computed_types
from ecm_studio.domain.errors import Diagnostic, ImportInvalid, ImportUnsupportedFormat
from ecm_studio.domain.models import Capability, now_iso
from ecm_studio.infrastructure.jsonl import atomic_write_text, serialize_jsonl

ImportFormat = Literal["jsonl", "csv", "json_bundle"]
ImportMode = Literal["validate_only", "append", "replace", "merge_by_id"]


@dataclass(frozen=True)
class ImportPlan:
    source_path: Path
    format_name: ImportFormat
    mode: ImportMode
    incoming: list[Capability]
    result: list[Capability]
    diagnostics: list[Diagnostic]
    added: int = 0
    updated: int = 0
    skipped: int = 0

    @property
    def invalid(self) -> int:
        return sum(1 for item in self.diagnostics if item.severity == "error")

    def to_dict(self, applied: bool = False, checkpoint_id: str | None = None) -> dict[str, Any]:
        return {
            "source_path": str(self.source_path),
            "format": self.format_name,
            "mode": self.mode,
            "total": len(self.incoming),
            "added": self.added,
            "updated": self.updated,
            "skipped": self.skipped,
            "invalid": self.invalid,
            "diagnostics": [item.to_dict() for item in self.diagnostics],
            "applied": applied,
            "checkpoint_id": checkpoint_id,
        }


class ModelIOService:
    def read_import(
        self, source_path: Path
    ) -> tuple[ImportFormat, list[Capability], list[Diagnostic]]:
        format_name = detect_import_format(source_path)
        if format_name == "jsonl":
            return format_name, *self._read_jsonl(source_path)
        if format_name == "csv":
            return format_name, *self._read_csv(source_path)
        if format_name == "json_bundle":
            return format_name, *self._read_json_bundle(source_path)
        raise ImportUnsupportedFormat(format_name)

    def preview(
        self, source_path: Path, existing: list[Capability], mode: ImportMode
    ) -> ImportPlan:
        format_name, incoming, diagnostics = self.read_import(source_path)
        result, added, updated, skipped, plan_diagnostics = self._plan(existing, incoming, mode)
        diagnostics.extend(plan_diagnostics)
        return ImportPlan(
            source_path=source_path,
            format_name=format_name,
            mode=mode,
            incoming=incoming,
            result=result,
            diagnostics=diagnostics,
            added=added,
            updated=updated,
            skipped=skipped,
        )

    def export(
        self, format_name: ImportFormat, target_path: Path, capabilities: list[Capability]
    ) -> Path:
        capabilities = with_computed_types(capabilities)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        if format_name == "jsonl":
            content = serialize_jsonl(
                capability.durable_dict() for capability in capabilities
            )
            atomic_write_text(
                target_path,
                content,
            )
        elif format_name == "csv":
            self._export_csv(target_path, capabilities)
        elif format_name == "json_bundle":
            bundle = {
                "_t": "ecm_model_bundle",
                "schema_version": "1.0",
                "exported_at": now_iso(),
                "capabilities": [capability.durable_dict() for capability in capabilities],
            }
            atomic_write_text(
                target_path,
                json.dumps(bundle, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            )
        else:
            raise ImportUnsupportedFormat(format_name)
        return target_path

    def _read_jsonl(self, source_path: Path) -> tuple[list[Capability], list[Diagnostic]]:
        capabilities: list[Capability] = []
        diagnostics: list[Diagnostic] = []
        for line_number, line in enumerate(source_path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            try:
                raw = json.loads(line)
            except json.JSONDecodeError as exc:
                diagnostics.append(
                    Diagnostic(
                        code="JSONL_PARSE_FAILED",
                        message=f"JSON parse error: {exc.msg}",
                        path=str(source_path),
                        line=line_number,
                    )
                )
                continue
            capability = _capability_from_raw(raw, str(source_path), line_number)
            if isinstance(capability, Diagnostic):
                diagnostics.append(capability)
            else:
                capabilities.append(capability)
        return capabilities, diagnostics

    def _read_json_bundle(self, source_path: Path) -> tuple[list[Capability], list[Diagnostic]]:
        try:
            raw = json.loads(source_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            return [], [
                Diagnostic(
                    code="JSON_PARSE_FAILED",
                    message=f"JSON parse error: {exc.msg}",
                    path=str(source_path),
                )
            ]
        if not isinstance(raw, dict) or raw.get("_t") != "ecm_model_bundle":
            return [], [
                Diagnostic(
                    code="IMPORT_INVALID",
                    message="JSON bundle must be an ecm_model_bundle object.",
                    path=str(source_path),
                )
            ]
        items = raw.get("capabilities")
        if not isinstance(items, list):
            return [], [
                Diagnostic(
                    code="IMPORT_INVALID",
                    message="JSON bundle capabilities must be an array.",
                    path=str(source_path),
                )
            ]
        capabilities: list[Capability] = []
        diagnostics: list[Diagnostic] = []
        for index, item in enumerate(items, 1):
            capability = _capability_from_raw(item, str(source_path), index)
            if isinstance(capability, Diagnostic):
                diagnostics.append(capability)
            else:
                capabilities.append(capability)
        return capabilities, diagnostics

    def _read_csv(self, source_path: Path) -> tuple[list[Capability], list[Diagnostic]]:
        capabilities: list[Capability] = []
        diagnostics: list[Diagnostic] = []
        with source_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            for row_number, row in enumerate(reader, 2):
                raw = _raw_from_csv_row(row)
                capability = _capability_from_raw(raw, str(source_path), row_number)
                if isinstance(capability, Diagnostic):
                    diagnostics.append(capability)
                else:
                    capabilities.append(capability)
        return capabilities, diagnostics

    def _plan(
        self, existing: list[Capability], incoming: list[Capability], mode: ImportMode
    ) -> tuple[list[Capability], int, int, int, list[Diagnostic]]:
        diagnostics = _validate_capabilities(
            incoming, "import", require_parents=mode == "validate_only"
        )
        if diagnostics or mode == "validate_only":
            return existing, 0, 0, 0, diagnostics

        existing_by_id = {capability.id: capability for capability in existing}
        existing_names = {normalize_name(capability.name) for capability in existing}
        added = 0
        updated = 0
        skipped = 0

        if mode == "append":
            result = list(existing)
            for capability in incoming:
                duplicate_id = capability.id in existing_by_id
                duplicate_name = normalize_name(capability.name) in existing_names
                if duplicate_id or duplicate_name:
                    skipped += 1
                    diagnostics.append(
                        Diagnostic(
                            code="IMPORT_SKIPPED_DUPLICATE",
                            message=(
                                f'Capability "{capability.name}" already exists and '
                                "was skipped."
                            ),
                            severity="warning",
                            path="import",
                        )
                    )
                    continue
                result.append(capability)
                existing_by_id[capability.id] = capability
                existing_names.add(normalize_name(capability.name))
                added += 1
        elif mode == "replace":
            result = list(incoming)
            added = len(incoming)
        elif mode == "merge_by_id":
            result = list(existing)
            positions = {capability.id: index for index, capability in enumerate(result)}
            for capability in incoming:
                if capability.id in positions:
                    result[positions[capability.id]] = capability
                    updated += 1
                else:
                    result.append(capability)
                    positions[capability.id] = len(result) - 1
                    added += 1
        else:
            raise ImportInvalid([{"code": "IMPORT_INVALID_MODE", "mode": mode}])

        result = with_computed_types(result)
        diagnostics.extend(_validate_capabilities(result, "result", require_parents=True))
        return result, added, updated, skipped, diagnostics

    def _export_csv(self, path: Path, capabilities: list[Capability]) -> None:
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=[
                    "id",
                    "name",
                    "parent_id",
                    "order",
                    "domain",
                    "type",
                    "lifecycle_status",
                    "description",
                    "aliases",
                    "tags",
                    "steward_id",
                    "steward_department",
                ],
            )
            writer.writeheader()
            for capability in capabilities:
                writer.writerow(
                    {
                        "id": capability.id,
                        "name": capability.name,
                        "parent_id": capability.parent_id or "",
                        "order": capability.order,
                        "domain": capability.domain,
                        "type": capability.type,
                        "lifecycle_status": capability.lifecycle_status,
                        "description": capability.description,
                        "aliases": ";".join(capability.aliases),
                        "tags": ";".join(capability.tags),
                        "steward_id": capability.steward_id,
                        "steward_department": capability.steward_department,
                    }
                )


def detect_import_format(path: Path) -> ImportFormat:
    suffix = path.suffix.lower()
    if suffix == ".jsonl":
        return "jsonl"
    if suffix == ".csv":
        return "csv"
    if suffix == ".json":
        return "json_bundle"
    raise ImportUnsupportedFormat(suffix or path.name)


def default_export_path(workspace_root: Path, format_name: ImportFormat) -> Path:
    filename = {
        "jsonl": "capabilities.jsonl",
        "csv": "capabilities.csv",
        "json_bundle": "capabilities.bundle.json",
    }[format_name]
    return workspace_root / "ecm" / "exports" / filename


def _capability_from_raw(raw: Any, path: str, line: int | None = None) -> Capability | Diagnostic:
    if not isinstance(raw, dict):
        return Diagnostic(
            code="IMPORT_INVALID",
            message="Capability record must be an object.",
            path=path,
            line=line,
        )
    raw = {key: value for key, value in raw.items() if value is not None and value != ""}
    raw.setdefault("_t", "capability")
    raw.setdefault("schema_version", "1.0")
    try:
        return Capability.model_validate(raw)
    except ValidationError as exc:
        message = exc.errors()[0].get("msg", str(exc))
        return Diagnostic(code="IMPORT_INVALID", message=message, path=path, line=line)


def _raw_from_csv_row(row: dict[str, Any]) -> dict[str, Any]:
    raw: dict[str, Any] = {
        "_t": "capability",
        "schema_version": "1.0",
        "id": row.get("id") or None,
        "name": row.get("name") or "",
        "parent_id": row.get("parent_id") or None,
        "domain": row.get("domain") or "",
        "type": row.get("type") or "leaf",
        "lifecycle_status": row.get("lifecycle_status") or "Draft",
        "description": row.get("description") or "",
        "aliases": _split_multi(row.get("aliases")),
        "tags": _split_multi(row.get("tags")),
        "steward_id": row.get("steward_id") or "",
        "steward_department": row.get("steward_department") or "",
    }
    order = row.get("order")
    if order not in {None, ""}:
        raw["order"] = order
    return raw


def _split_multi(value: Any) -> list[str]:
    if value is None:
        return []
    return [part.strip() for part in str(value).replace(",", ";").split(";") if part.strip()]


def _validate_capabilities(
    capabilities: list[Capability], path: str, require_parents: bool
) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    ids: set[str] = set()
    names: dict[str, str] = {}
    by_id = {capability.id: capability for capability in capabilities}

    for capability in capabilities:
        if capability.id in ids:
            diagnostics.append(
                Diagnostic(
                    code="IMPORT_INVALID",
                    message=f'Duplicate capability id "{capability.id}".',
                    path=path,
                )
            )
        ids.add(capability.id)
        name = normalize_name(capability.name)
        if name in names:
            diagnostics.append(
                Diagnostic(
                    code="DUPLICATE_NAME",
                    message=f'Duplicate capability name "{capability.name}".',
                    path=path,
                )
            )
        names[name] = capability.id
        if require_parents and capability.parent_id and capability.parent_id not in by_id:
            diagnostics.append(
                Diagnostic(
                    code="VALIDATION_FAILED",
                    message=(
                        f'Parent "{capability.parent_id}" for "{capability.name}" '
                        "does not exist."
                    ),
                    path=path,
                )
            )

    for capability in capabilities:
        seen: set[str] = set()
        current: Capability | None = capability
        while current is not None:
            if current.id in seen:
                diagnostics.append(
                    Diagnostic(
                        code="CYCLE_DETECTED",
                        message=(
                            f'Capability "{capability.name}" participates in a '
                            "hierarchy cycle."
                        ),
                        path=path,
                    )
                )
                break
            seen.add(current.id)
            current = by_id.get(current.parent_id) if current.parent_id else None
    return diagnostics
