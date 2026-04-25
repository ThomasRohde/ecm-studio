from __future__ import annotations

from pathlib import Path
from typing import Any

from pydantic import ValidationError

from ecm_workbench.domain.capabilities import (
    build_tree,
    create_capability,
    move_capability,
    replace_capability,
    update_capability,
)
from ecm_workbench.domain.errors import (
    Diagnostic,
    ImportInvalid,
    JsonlParseFailed,
    ValidationFailed,
)
from ecm_workbench.domain.models import Capability, CapabilityCreate, CapabilityPatch
from ecm_workbench.infrastructure.git_service import GitService
from ecm_workbench.infrastructure.model_io import (
    ImportFormat,
    ImportMode,
    ModelIOService,
    default_export_path,
)
from ecm_workbench.infrastructure.repository import CapabilityRepository
from ecm_workbench.infrastructure.settings import SettingsRepository
from ecm_workbench.infrastructure.sqlite_projection import SQLiteProjection
from ecm_workbench.infrastructure.workspace import WorkspaceRepository

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
        workspace = self.context.init_workspace(Path(path), name)
        GitService(workspace.root).init()
        rebuild = SQLiteProjection(workspace).rebuild()
        self.settings.add_recent_workspace(workspace.root)
        return self._dto(workspace, rebuild.to_dict())

    def open(self, path: str | None = None) -> dict[str, Any]:
        if path is None:
            workspace = self.context.require_workspace()
        else:
            workspace = self.context.open_workspace(Path(path))
            self.settings.add_recent_workspace(workspace.root)
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
        self._save_and_rebuild(capabilities)
        return capability_dto(capability)

    def update(self, capability_id: str, patch_data: dict[str, Any]) -> dict[str, Any]:
        sanitized = {
            key: value
            for key, value in patch_data.items()
            if value is not None or key in {"effective_from", "effective_to"}
        }
        try:
            patch = CapabilityPatch.model_validate(sanitized)
        except ValidationError as exc:
            raise ValidationFailed("Invalid capability patch input.", exc.errors()) from exc
        capabilities = self._load()
        updated = update_capability(capabilities, capability_id, patch)
        capabilities = replace_capability(capabilities, updated)
        self._save_and_rebuild(capabilities)
        return capability_dto(updated)

    def move(
        self, capability_id: str, new_parent_id: str | None, order: int | None = None
    ) -> dict[str, Any]:
        capabilities = self._load()
        moved = move_capability(capabilities, capability_id, new_parent_id, order)
        capabilities = replace_capability(capabilities, moved)
        self._save_and_rebuild(capabilities)
        return capability_dto(moved)

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

    def _save_and_rebuild(self, capabilities: list[Capability]) -> None:
        self._repo().save(capabilities)
        SQLiteProjection(self.context.require_workspace()).rebuild()


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
        CapabilityRepository(workspace.paths.capabilities_file).save(plan.result)
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
                        code="JSONL_PARSE_FAILED",
                        message=error["message"],
                        path="ecm/capabilities.jsonl",
                        line=error["line"],
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
