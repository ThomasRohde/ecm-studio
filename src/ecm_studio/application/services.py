from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import ValidationError

from ecm_studio.domain.capabilities import (
    build_tree,
    create_capability,
    get_capability,
    move_capability,
    replace_capability,
    update_capability,
    with_computed_types,
)
from ecm_studio.domain.errors import (
    Diagnostic,
    ImportInvalid,
    JsonlParseFailed,
    ValidationFailed,
)
from ecm_studio.domain.models import (
    Capability,
    CapabilityCreate,
    CapabilityEvent,
    CapabilityPatch,
    ModelEvent,
)
from ecm_studio.infrastructure.events import EventRepository
from ecm_studio.infrastructure.git_service import GitService
from ecm_studio.infrastructure.jsonl import read_raw_jsonl
from ecm_studio.infrastructure.model_io import (
    ImportFormat,
    ImportMode,
    ModelIOService,
    default_export_path,
)
from ecm_studio.infrastructure.paths import CAPABILITY_VERSIONS_FILE, MODEL_VERSIONS_FILE
from ecm_studio.infrastructure.repository import CapabilityRepository
from ecm_studio.infrastructure.settings import SettingsRepository
from ecm_studio.infrastructure.sqlite_projection import SQLiteProjection
from ecm_studio.infrastructure.workspace import WorkspaceRepository

from .context import AppContext


def capability_dto(capability: Capability) -> dict[str, Any]:
    return capability.model_dump(mode="json", by_alias=True)


def tree_dto(nodes: list) -> list[dict[str, Any]]:
    return [
        {**capability_dto(node.capability), "children": tree_dto(node.children)} for node in nodes
    ]


class SettingsService:
    def __init__(self, settings: SettingsRepository) -> None:
        self.settings = settings

    def get(self) -> dict[str, Any]:
        return self.settings.load().to_dict()

    def update(self, patch: dict[str, Any]) -> dict[str, Any]:
        theme_mode = patch.get("theme_mode")
        if theme_mode is not None and theme_mode not in {"system", "light", "dark"}:
            raise ValidationFailed("Theme mode must be system, light, or dark.")
        return self.settings.update(theme_mode=theme_mode).to_dict()


class WorkspaceService:
    def __init__(self, context: AppContext, settings: SettingsRepository) -> None:
        self.context = context
        self.settings = settings

    def init(self, path: str, name: str) -> dict[str, Any]:
        previous = self.context.workspace
        try:
            workspace = self.context.init_workspace(Path(path), name)
            GitService(workspace.root).init()
            rebuild = SQLiteProjection(workspace).rebuild()
        except Exception:
            self.context.workspace = previous
            raise
        self.settings.add_recent_workspace(workspace.root)
        return self._dto(workspace, rebuild.to_dict())

    def open(self, path: str | None = None) -> dict[str, Any]:
        previous = self.context.workspace
        if path is None:
            workspace = self.context.require_workspace()
        else:
            try:
                workspace = self.context.open_workspace(Path(path))
                projection = SQLiteProjection(workspace)
                rebuild = None
                if not projection.is_current():
                    rebuild = projection.rebuild().to_dict()
            except Exception:
                self.context.workspace = previous
                raise
            self.settings.add_recent_workspace(workspace.root)
            return self._dto(workspace, rebuild)
        projection = SQLiteProjection(workspace)
        rebuild = None
        if not projection.is_current():
            rebuild = projection.rebuild().to_dict()
        return self._dto(workspace, rebuild)

    def status(self) -> dict[str, Any]:
        workspace = self.context.require_workspace()
        projection = SQLiteProjection(workspace)
        return self._dto(workspace, None, index_current=projection.is_current())

    def rebuild_index(self) -> dict[str, Any]:
        workspace = self.context.require_workspace()
        return SQLiteProjection(workspace).rebuild().to_dict()

    def _dto(
        self,
        workspace: WorkspaceRepository,
        rebuild: dict[str, Any] | None,
        index_current: bool = True,
    ) -> dict[str, Any]:
        config = workspace.load_config()
        git_status = GitService(workspace.root).status()
        return {
            "path": str(workspace.root),
            "name": config.name,
            "initialized": True,
            "index_current": index_current,
            "rebuild": rebuild,
            "git": git_status,
        }


class CapabilityService:
    def __init__(self, context: AppContext) -> None:
        self.context = context

    def list_tree(self) -> list[dict[str, Any]]:
        capabilities = self._load()
        return tree_dto(build_tree(capabilities))

    def get(self, capability_id: str) -> dict[str, Any]:
        for capability in self._load():
            if capability.id == capability_id:
                return capability_dto(capability)
        raise ValidationFailed(f'Capability "{capability_id}" does not exist.')

    def create(self, input_data: dict[str, Any]) -> dict[str, Any]:
        try:
            create_input = CapabilityCreate.model_validate(input_data)
        except ValidationError as exc:
            raise ValidationFailed("Invalid capability create input.", exc.errors()) from exc
        capabilities = self._load()
        capability = create_capability(capabilities, create_input)
        capabilities.append(capability)
        capabilities = with_computed_types(capabilities)
        capability = get_capability(capabilities, capability.id)
        self._save_and_rebuild(
            capabilities,
            CapabilityEvent(
                capability_id=capability.id,
                action="create",
                summary=f'Created capability "{capability.name}".',
                after=capability.durable_dict(),
                patch=create_input.model_dump(exclude_unset=True, mode="json"),
            ),
        )
        return capability_dto(capability)

    def update(self, capability_id: str, patch_data: dict[str, Any]) -> dict[str, Any]:
        sanitized = _sanitize_capability_patch(patch_data)
        try:
            patch = CapabilityPatch.model_validate(sanitized)
        except ValidationError as exc:
            raise ValidationFailed("Invalid capability patch input.", exc.errors()) from exc
        capabilities = self._load()
        before = get_capability(capabilities, capability_id)
        updated = update_capability(capabilities, capability_id, patch)
        capabilities = replace_capability(capabilities, updated)
        capabilities = with_computed_types(capabilities)
        updated = get_capability(capabilities, updated.id)
        self._save_and_rebuild(
            capabilities,
            CapabilityEvent(
                capability_id=updated.id,
                action="update",
                summary=f'Updated capability "{updated.name}".',
                before=before.durable_dict(),
                after=updated.durable_dict(),
                patch=patch.model_dump(exclude_unset=True, mode="json"),
            ),
        )
        return capability_dto(updated)

    def move(
        self, capability_id: str, new_parent_id: str | None, order: int | None = None
    ) -> dict[str, Any]:
        capabilities = self._load()
        before = get_capability(capabilities, capability_id)
        capabilities, moved = move_capability(capabilities, capability_id, new_parent_id, order)
        capabilities = with_computed_types(capabilities)
        moved = get_capability(capabilities, moved.id)
        self._save_and_rebuild(
            capabilities,
            CapabilityEvent(
                capability_id=moved.id,
                action="move",
                summary=f'Moved capability "{moved.name}".',
                before=before.durable_dict(),
                after=moved.durable_dict(),
                patch={"parent_id": new_parent_id, "order": moved.order},
            ),
        )
        return capability_dto(moved)

    def save(
        self,
        capability_id: str,
        patch_data: dict[str, Any],
        new_parent_id: str | None,
        order: int | None = None,
    ) -> dict[str, Any]:
        sanitized = _sanitize_capability_patch(patch_data)
        try:
            patch = CapabilityPatch.model_validate(sanitized)
        except ValidationError as exc:
            raise ValidationFailed("Invalid capability patch input.", exc.errors()) from exc

        capabilities = self._load()
        before = get_capability(capabilities, capability_id)
        patch_payload = patch.model_dump(exclude_unset=True, mode="json")
        metadata_changed = _patch_has_changes(before, patch_payload)
        parent_changed = before.parent_id != new_parent_id
        order_changed = order is not None and before.order != order
        if not metadata_changed and not parent_changed and not order_changed:
            return capability_dto(before)

        working = capabilities
        updated = before
        events: list[CapabilityEvent] = []

        if metadata_changed:
            updated = update_capability(working, capability_id, patch)
            working = with_computed_types(replace_capability(working, updated))
            updated = get_capability(working, capability_id)
            events.append(
                CapabilityEvent(
                    capability_id=updated.id,
                    action="update",
                    summary=f'Updated capability "{updated.name}".',
                    before=before.durable_dict(),
                    after=updated.durable_dict(),
                    patch=patch_payload,
                )
            )

        final = updated
        if parent_changed or order_changed:
            move_before = updated
            working, moved = move_capability(working, capability_id, new_parent_id, order)
            working = with_computed_types(working)
            final = get_capability(working, moved.id)
            events.append(
                CapabilityEvent(
                    capability_id=final.id,
                    action="move",
                    summary=f'Moved capability "{final.name}".',
                    before=move_before.durable_dict(),
                    after=final.durable_dict(),
                    patch={"parent_id": new_parent_id, "order": final.order},
                )
            )

        self._save_and_rebuild(working, events)
        return capability_dto(final)

    def export(self, format_name: str) -> dict[str, Any]:
        workspace = self.context.require_workspace()
        capabilities = self._load()
        format_value = _model_format(format_name)
        path = ModelIOService().export(
            format_value, default_export_path(workspace.root, format_value), capabilities
        )
        return {"path": str(path), "count": len(capabilities)}

    def _repo(self) -> CapabilityRepository:
        workspace = self.context.require_workspace()
        return CapabilityRepository(workspace.paths.capabilities_file)

    def _load(self) -> list[Capability]:
        capabilities, errors = self._repo().load()
        if errors:
            raise JsonlParseFailed(errors)
        return capabilities

    def _save_and_rebuild(
        self,
        capabilities: list[Capability],
        event: CapabilityEvent | list[CapabilityEvent] | None = None,
    ) -> None:
        workspace = self.context.require_workspace()
        CapabilityRepository(workspace.paths.capabilities_file).save(capabilities)
        if event is not None:
            event_repo = EventRepository(workspace.paths.resolve(CAPABILITY_VERSIONS_FILE))
            events = event if isinstance(event, list) else [event]
            for item in events:
                event_repo.append_capability_event(item)
        SQLiteProjection(workspace).rebuild()


class SearchService:
    def __init__(self, context: AppContext) -> None:
        self.context = context

    def query(self, q: str, filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        _ = filters
        workspace = self.context.require_workspace()
        projection = SQLiteProjection(workspace)
        if not projection.is_current():
            projection.rebuild()
        return projection.search(q)


class ModelService:
    def __init__(self, context: AppContext) -> None:
        self.context = context
        self.io = ModelIOService()

    def import_preview(self, source_path: str, mode: str = "validate_only") -> dict[str, Any]:
        workspace = self.context.require_workspace()
        plan = self.io.preview(
            Path(source_path), self._load(workspace), _import_mode(mode)
        )
        return plan.to_dict(applied=False)

    def import_apply(self, source_path: str, mode: str) -> dict[str, Any]:
        workspace = self.context.require_workspace()
        import_mode = _import_mode(mode)
        plan = self.io.preview(Path(source_path), self._load(workspace), import_mode)
        if plan.invalid:
            raise ImportInvalid([item.to_dict() for item in plan.diagnostics])
        checkpoint_id = None
        if import_mode in {"replace", "merge_by_id"}:
            git = GitService(workspace.root)
            if git.is_repo():
                checkpoint = git.checkpoint(f"Pre-import checkpoint for {Path(source_path).name}")
                checkpoint_id = checkpoint.id or None
        import_result = with_computed_types(plan.result)
        CapabilityRepository(workspace.paths.capabilities_file).save(import_result)
        EventRepository(workspace.paths.resolve(MODEL_VERSIONS_FILE)).append_model_event(
            ModelEvent(
                action=f"import_{import_mode}",
                summary=f'Imported model from "{Path(source_path).name}" using {import_mode}.',
                capability_count=len(import_result),
                source_path=str(source_path),
                checkpoint_id=checkpoint_id,
            )
        )
        rebuild = SQLiteProjection(workspace).rebuild()
        result = plan.to_dict(applied=True, checkpoint_id=checkpoint_id)
        result["rebuild"] = rebuild.to_dict()
        return result

    def export(self, format_name: str, target_path: str | None = None) -> dict[str, Any]:
        workspace = self.context.require_workspace()
        format_value = _model_format(format_name)
        capabilities = self._load(workspace)
        path = (
            Path(target_path)
            if target_path
            else default_export_path(workspace.root, format_value)
        )
        path = self.io.export(format_value, path, capabilities)
        return {"format": format_value, "path": str(path), "count": len(capabilities)}

    def _load(self, workspace: WorkspaceRepository) -> list[Capability]:
        capabilities, errors = CapabilityRepository(workspace.paths.capabilities_file).load()
        if errors:
            raise JsonlParseFailed(errors)
        return capabilities


class GitAppService:
    def __init__(self, context: AppContext) -> None:
        self.context = context

    def status(self) -> dict[str, Any]:
        return GitService(self.context.require_workspace().root).status()

    def checkpoint(self, message: str) -> dict[str, Any]:
        return GitService(self.context.require_workspace().root).checkpoint(message).to_dict()

    def history(self, limit: int = 50) -> list[dict[str, Any]]:
        return [
            item.to_dict()
            for item in GitService(self.context.require_workspace().root).history(limit)
        ]

    def compare(self, from_ref: str, to_ref: str) -> dict[str, Any]:
        return GitService(self.context.require_workspace().root).compare(from_ref, to_ref)

    def restore(self, checkpoint_id: str, force: bool = False) -> dict[str, Any]:
        workspace = self.context.require_workspace()
        GitService(workspace.root).restore(checkpoint_id, force=force)
        rebuild = SQLiteProjection(workspace).rebuild()
        return rebuild.to_dict()

    def list_branches(self) -> list[str]:
        return GitService(self.context.require_workspace().root).list_branches()

    def create_branch(self, name: str) -> dict[str, Any]:
        return GitService(self.context.require_workspace().root).create_branch(name)

    def switch_branch(self, name: str) -> dict[str, Any]:
        workspace = self.context.require_workspace()
        result = GitService(workspace.root).switch_branch(name)
        result["rebuild"] = SQLiteProjection(workspace).rebuild().to_dict()
        return result

    def merge_branch(self, source_branch: str) -> dict[str, Any]:
        workspace = self.context.require_workspace()
        result = GitService(workspace.root).merge_branch(source_branch)
        result["rebuild"] = SQLiteProjection(workspace).rebuild().to_dict()
        return result

    def abort_merge(self) -> dict[str, Any]:
        return GitService(self.context.require_workspace().root).abort_merge()

    def pull(self) -> dict[str, Any]:
        workspace = self.context.require_workspace()
        result = GitService(workspace.root).pull()
        result["rebuild"] = SQLiteProjection(workspace).rebuild().to_dict()
        return result

    def push(self) -> dict[str, Any]:
        return GitService(self.context.require_workspace().root).push()


class DiagnosticsService:
    def __init__(self, context: AppContext) -> None:
        self.context = context

    def run(self) -> list[dict[str, Any]]:
        diagnostics: list[Diagnostic] = []
        workspace = self.context.require_workspace()
        if not workspace.paths.capabilities_file.exists():
            diagnostics.append(
                Diagnostic(
                    code="MISSING_CAPABILITIES_FILE",
                    message="ecm/capabilities.jsonl is missing.",
                    path="ecm/capabilities.jsonl",
                )
            )
        else:
            _, errors = CapabilityRepository(workspace.paths.capabilities_file).load()
            for error in errors:
                diagnostics.append(
                    Diagnostic(
                        code=error.get("code", "JSONL_PARSE_FAILED"),
                        message=error["message"],
                        severity=error.get("severity", "error"),
                        path="ecm/capabilities.jsonl",
                        line=error["line"],
                    )
                )
        for relative in [CAPABILITY_VERSIONS_FILE, MODEL_VERSIONS_FILE]:
            event_result = read_raw_jsonl(workspace.paths.resolve(relative))
            for error in event_result.errors:
                diagnostics.append(
                    Diagnostic(
                        code=error.code,
                        message=error.message,
                        severity=error.severity,
                        path=relative,
                        line=error.line,
                    )
                )
        projection = SQLiteProjection(workspace)
        if not projection.is_current():
            diagnostics.append(
                Diagnostic(
                    code="INDEX_STALE",
                    message="SQLite projection is missing or stale.",
                    severity="warning",
                )
            )
        git_status = GitService(workspace.root).status()
        for file_path in git_status.get("conflicted_files", []):
            diagnostics.append(
                Diagnostic(
                    code="GIT_CONFLICT",
                    message=f"Git conflict in {file_path}.",
                    path=file_path,
                )
            )
        return [diagnostic.to_dict() for diagnostic in diagnostics]


class AuditService:
    def __init__(self, context: AppContext) -> None:
        self.context = context

    def recent(self, limit: int = 100) -> list[dict[str, Any]]:
        workspace = self.context.require_workspace()
        events: list[dict[str, Any]] = []
        for relative in [CAPABILITY_VERSIONS_FILE, MODEL_VERSIONS_FILE]:
            for item in EventRepository(workspace.paths.resolve(relative)).recent(limit):
                events.append({"source": relative, **item})
        events.sort(key=_audit_sort_key, reverse=True)
        return events[: max(0, limit)]


class AppServices:
    def __init__(self, settings_path: Path | None = None) -> None:
        settings = SettingsRepository(settings_path)
        self.settings = SettingsService(settings)
        self.context = AppContext()
        self.workspace = WorkspaceService(self.context, settings)
        self.capabilities = CapabilityService(self.context)
        self.models = ModelService(self.context)
        self.search = SearchService(self.context)
        self.git = GitAppService(self.context)
        self.diagnostics = DiagnosticsService(self.context)
        self.audit = AuditService(self.context)


def _import_mode(value: str) -> ImportMode:
    if value in {"validate_only", "append", "replace", "merge_by_id"}:
        return value
    raise ValidationFailed("Import mode must be validate_only, append, replace, or merge_by_id.")


def _model_format(value: str) -> ImportFormat:
    if value == "json":
        return "json_bundle"
    if value in {"jsonl", "csv", "json_bundle"}:
        return value
    raise ValidationFailed("Model format must be jsonl, csv, or json_bundle.")


def _sanitize_capability_patch(patch_data: dict[str, Any]) -> dict[str, Any]:
    allowed = set(CapabilityPatch.model_fields)
    ignored = {
        "_t",
        "schema_version",
        "id",
        "parent_id",
        "order",
        "type",
        "created_at",
        "updated_at",
        "children",
    }
    unknown = set(patch_data) - allowed - ignored
    if unknown:
        raise ValidationFailed(
            "Invalid capability patch input.",
            [{"field": field, "message": "Unknown patch field."} for field in sorted(unknown)],
        )
    return {
        key: value
        for key, value in patch_data.items()
        if key in allowed and (value is not None or key in {"effective_from", "effective_to"})
    }


def _patch_has_changes(capability: Capability, patch: dict[str, Any]) -> bool:
    return any(getattr(capability, key) != value for key, value in patch.items())


def _audit_sort_key(item: dict[str, Any]) -> str:
    record = item.get("record")
    if isinstance(record, dict):
        return str(record.get("created_at", ""))
    return ""
