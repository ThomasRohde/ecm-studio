from __future__ import annotations

import re
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
    AppError,
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
    PublishEvent,
    now_iso,
)
from ecm_studio.infrastructure.events import EventRepository
from ecm_studio.infrastructure.git_service import GitService
from ecm_studio.infrastructure.github_release import (
    GitHubCliStatus,
    GitHubReleaseService,
    parse_github_remote_url,
)
from ecm_studio.infrastructure.jsonl import read_raw_jsonl
from ecm_studio.infrastructure.model_io import (
    ImportFormat,
    ImportMode,
    ModelIOService,
    default_export_path,
)
from ecm_studio.infrastructure.paths import (
    CAPABILITY_VERSIONS_FILE,
    MODEL_VERSIONS_FILE,
    PUBLISH_EVENTS_FILE,
)
from ecm_studio.infrastructure.repository import CapabilityRepository
from ecm_studio.infrastructure.settings import SettingsRepository
from ecm_studio.infrastructure.sqlite_projection import SQLiteProjection
from ecm_studio.infrastructure.workspace import WorkspaceRepository

from .context import AppContext

RELEASE_VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
RELEASE_TAG_RE = re.compile(r"^ecm-v\d+\.\d+\.\d+$")


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

    def graph(self, limit: int = 50) -> dict[str, Any]:
        return GitService(self.context.require_workspace().root).graph(limit)

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


class ReleaseAppService:
    def __init__(
        self,
        context: AppContext,
        github: GitHubReleaseService | None = None,
    ) -> None:
        self.context = context
        self.github = github or GitHubReleaseService()
        self.io = ModelIOService()

    def status(self) -> dict[str, Any]:
        workspace = self.context.require_workspace()
        git = GitService(workspace.root)
        git_status = git.status()
        remote_url = git.remote_url("origin") if git_status["is_repo"] else None
        remote = parse_github_remote_url(remote_url or "", "origin") if remote_url else None
        github_cli = (
            self.github.cli_status(remote.host)
            if remote is not None
            else GitHubCliStatus(False, False, None)
        )
        latest_release = self._latest_release(workspace)
        cut_blockers = self._base_blockers(git_status, remote_url, remote)
        publish_blockers = [
            *cut_blockers,
            *self._github_cli_blockers(remote, github_cli),
        ]

        if latest_release is None:
            publish_blockers.append(
                _release_blocker(
                    "RELEASE_TAG_MISSING",
                    "No local release is available to publish.",
                )
            )
        elif git_status["is_repo"] and not git.tag_exists(latest_release["tag"]):
            publish_blockers.append(
                _release_blocker(
                    "RELEASE_TAG_MISSING",
                    f'Release tag "{latest_release["tag"]}" does not exist.',
                )
            )
        elif latest_release.get("delivery_status") == "success":
            publish_blockers.append(
                _release_blocker(
                    "GITHUB_RELEASE_FAILED",
                    f'Release "{latest_release["tag"]}" has already been published.',
                )
            )

        return {
            "can_cut": not cut_blockers,
            "can_publish": not publish_blockers,
            "cut_blockers": cut_blockers,
            "publish_blockers": publish_blockers,
            "remote": remote.to_dict() if remote else _remote_status(remote_url),
            "github_cli": github_cli.to_dict(),
            "latest_release": latest_release,
        }

    def cut(self, version: str, notes: str | None = None) -> dict[str, Any]:
        normalized_version = _validate_release_version(version)
        tag = _release_tag(normalized_version)
        workspace = self.context.require_workspace()
        git = GitService(workspace.root)
        git_status = git.status()
        remote_url = git.remote_url("origin") if git_status["is_repo"] else None
        remote = parse_github_remote_url(remote_url or "", "origin") if remote_url else None
        blockers = self._base_blockers(git_status, remote_url, remote)
        if blockers:
            _raise_release_blocker(blockers[0])
        if git.tag_exists(tag):
            raise AppError("RELEASE_TAG_EXISTS", f'Release tag "{tag}" already exists.')

        diagnostics = DiagnosticsService(self.context).run()
        errors = [item for item in diagnostics if item.get("severity") == "error"]
        if errors:
            raise ValidationFailed("Release diagnostics failed.", errors)

        capabilities = self._load_capabilities(workspace)
        released_at = now_iso()
        export_paths = self._write_release_exports(workspace, tag, capabilities)
        release_event = ModelEvent(
            action="release",
            summary=f"Released ECM {tag}.",
            capability_count=len(capabilities),
            version_label=normalized_version,
            state="released",
            tag=tag,
            export_paths=export_paths,
            released_at=released_at,
        )
        EventRepository(workspace.paths.resolve(MODEL_VERSIONS_FILE)).append_model_event(
            release_event
        )
        checkpoint = git.checkpoint(f"Release {tag}")
        git.tag_release(tag, notes or f"Release {tag}")

        return {
            "version_label": normalized_version,
            "tag": tag,
            "checkpoint_id": checkpoint.id,
            "model_version_id": release_event.id,
            "export_paths": export_paths,
            "released_at": released_at,
        }

    def publish(self, tag: str) -> dict[str, Any]:
        normalized_tag = _validate_release_tag(tag)
        workspace = self.context.require_workspace()
        git = GitService(workspace.root)
        git_status = git.status()
        remote_url = git.remote_url("origin") if git_status["is_repo"] else None
        remote = parse_github_remote_url(remote_url or "", "origin") if remote_url else None
        github_cli = (
            self.github.cli_status(remote.host)
            if remote is not None
            else GitHubCliStatus(False, False, None)
        )
        blockers = [
            *self._base_blockers(git_status, remote_url, remote),
            *self._github_cli_blockers(remote, github_cli),
        ]
        if blockers:
            _raise_release_blocker(blockers[0])
        if not git.tag_exists(normalized_tag):
            raise AppError(
                "RELEASE_TAG_MISSING", f'Release tag "{normalized_tag}" does not exist.'
            )
        if not git.is_ancestor(normalized_tag, "HEAD"):
            raise AppError(
                "RELEASE_TAG_MISSING",
                f'Release tag "{normalized_tag}" is not reachable from the current branch.',
            )

        release = self._release_for_tag(workspace, normalized_tag)
        if release is None:
            raise AppError(
                "RELEASE_TAG_MISSING",
                f'Release metadata for "{normalized_tag}" does not exist.',
            )

        asset_paths, published_asset_paths = self._release_asset_paths(
            workspace,
            normalized_tag,
            release["export_paths"],
        )
        missing_assets = [str(path) for path in asset_paths if not path.exists()]
        if missing_assets:
            raise AppError(
                "GITHUB_RELEASE_FAILED",
                "Release assets are missing.",
                {"missing_assets": missing_assets},
            )

        git.push()
        git.push_tag(normalized_tag)
        github_url = self.github.create_release(
            workspace.root,
            remote,
            normalized_tag,
            f"ECM {normalized_tag}",
            f"Published ECM release {normalized_tag}.",
            asset_paths,
        )
        published_at = now_iso()
        publish_event = PublishEvent(
            event_type="github_release_created",
            model_version_id=release["id"],
            tag=normalized_tag,
            github_release_url=github_url,
            asset_paths=published_asset_paths,
            delivery_status="success",
            published_at=published_at,
        )
        EventRepository(workspace.paths.resolve(PUBLISH_EVENTS_FILE)).append_publish_event(
            publish_event
        )
        checkpoint = git.checkpoint(f"Record publication {normalized_tag}")
        pushed = git.push()

        return {
            "tag": normalized_tag,
            "github_release_url": github_url,
            "publish_event_id": publish_event.id,
            "checkpoint_id": checkpoint.id,
            "published_at": published_at,
            "pushed": pushed,
        }

    def _base_blockers(
        self,
        git_status: dict[str, Any],
        remote_url: str | None,
        remote: Any,
    ) -> list[dict[str, Any]]:
        blockers: list[dict[str, Any]] = []
        if not git_status["is_repo"]:
            blockers.append(
                _release_blocker("GIT_NOT_INITIALIZED", "Workspace is not a Git repository.")
            )
        elif not git_status.get("branch"):
            blockers.append(
                _release_blocker(
                    "RELEASE_DETACHED_HEAD",
                    "Switch to a named branch before cutting or publishing releases.",
                )
            )
        if not remote_url:
            blockers.append(
                _release_blocker(
                    "RELEASE_REMOTE_MISSING",
                    "Configure an origin remote before cutting or publishing releases.",
                )
            )
        elif remote is None:
            blockers.append(
                _release_blocker(
                    "RELEASE_REMOTE_NOT_GITHUB",
                    "The origin remote is not a supported GitHub or GHE remote.",
                )
            )
        if git_status.get("merge_in_progress") or git_status.get("conflicted_files"):
            blockers.append(
                _release_blocker(
                    "GIT_CONFLICT",
                    "Resolve or abort the integration conflict before releasing.",
                )
            )
        elif not git_status["clean"]:
            blockers.append(
                _release_blocker(
                    "RELEASE_WORKTREE_DIRTY",
                    "Create a checkpoint or discard pending changes before releasing.",
                )
            )
        if git_status.get("behind", 0) > 0:
            blockers.append(
                _release_blocker(
                    "RELEASE_INCOMING_CHANGES",
                    "Receive upstream changes before releasing.",
                )
            )
        return blockers

    def _github_cli_blockers(
        self,
        remote: Any,
        github_cli: GitHubCliStatus,
    ) -> list[dict[str, Any]]:
        if remote is None:
            return []
        if not github_cli.available:
            return [
                _release_blocker(
                    "GITHUB_CLI_MISSING",
                    github_cli.message or "GitHub CLI is required to publish releases.",
                )
            ]
        if not github_cli.authenticated:
            return [
                _release_blocker(
                    "GITHUB_AUTH_MISSING",
                    github_cli.message
                    or f"GitHub CLI is not authenticated for {remote.host}.",
                )
            ]
        return []

    def _release_asset_paths(
        self,
        workspace: WorkspaceRepository,
        tag: str,
        export_paths: Any,
    ) -> tuple[list[Path], list[str]]:
        expected_dir = (workspace.root / "ecm" / "exports" / tag).resolve()
        if not isinstance(export_paths, list) or not export_paths:
            raise AppError("GITHUB_RELEASE_FAILED", "Release assets are missing.")

        assets: list[Path] = []
        relative_assets: list[str] = []
        invalid_assets: list[str] = []
        for raw_path in export_paths:
            if not isinstance(raw_path, str) or not raw_path.strip():
                invalid_assets.append(str(raw_path))
                continue
            candidate = Path(raw_path)
            resolved = (
                candidate if candidate.is_absolute() else workspace.root / candidate
            ).resolve()
            try:
                resolved.relative_to(expected_dir)
            except ValueError:
                invalid_assets.append(raw_path)
                continue
            assets.append(resolved)
            relative_assets.append(_relative_path(workspace.root, resolved))

        if invalid_assets:
            raise AppError(
                "GITHUB_RELEASE_FAILED",
                "Release asset path is outside the release export directory.",
                {"invalid_assets": invalid_assets},
            )
        return assets, relative_assets

    def _write_release_exports(
        self,
        workspace: WorkspaceRepository,
        tag: str,
        capabilities: list[Capability],
    ) -> list[str]:
        export_dir = workspace.root / "ecm" / "exports" / tag
        targets = [
            ("jsonl", export_dir / "capabilities.jsonl"),
            ("csv", export_dir / "capabilities.csv"),
            ("json_bundle", export_dir / "capabilities.bundle.json"),
        ]
        paths: list[str] = []
        for format_name, path in targets:
            written = self.io.export(format_name, path, capabilities)
            paths.append(_relative_path(workspace.root, written))
        return paths

    def _load_capabilities(self, workspace: WorkspaceRepository) -> list[Capability]:
        capabilities, errors = CapabilityRepository(workspace.paths.capabilities_file).load()
        if errors:
            raise JsonlParseFailed(errors)
        return capabilities

    def _latest_release(self, workspace: WorkspaceRepository) -> dict[str, Any] | None:
        releases = self._release_records(workspace)
        if not releases:
            return None
        published = self._published_by_tag(workspace)
        latest = releases[-1]
        if latest["tag"] in published:
            latest = {**latest, **published[latest["tag"]]}
        return latest

    def _release_for_tag(
        self, workspace: WorkspaceRepository, tag: str
    ) -> dict[str, Any] | None:
        for release in reversed(self._release_records(workspace)):
            if release["tag"] == tag:
                return release
        return None

    def _release_records(self, workspace: WorkspaceRepository) -> list[dict[str, Any]]:
        result = read_raw_jsonl(workspace.paths.resolve(MODEL_VERSIONS_FILE))
        releases: list[dict[str, Any]] = []
        for record in result.records:
            if record.get("_t") != "model_version" or record.get("action") != "release":
                continue
            tag = record.get("tag")
            if not isinstance(tag, str) or not RELEASE_TAG_RE.match(tag):
                continue
            export_paths = record.get("export_paths")
            releases.append(
                {
                    "id": str(record.get("id", "")),
                    "version_label": str(record.get("version_label") or tag.removeprefix("ecm-v")),
                    "tag": tag,
                    "state": str(record.get("state") or "released"),
                    "capability_count": int(record.get("capability_count") or 0),
                    "export_paths": export_paths if isinstance(export_paths, list) else [],
                    "released_at": str(record.get("released_at") or record.get("created_at") or ""),
                    "checkpoint_id": record.get("checkpoint_id"),
                }
            )
        return releases

    def _published_by_tag(self, workspace: WorkspaceRepository) -> dict[str, dict[str, str]]:
        result = read_raw_jsonl(workspace.paths.resolve(PUBLISH_EVENTS_FILE))
        published: dict[str, dict[str, str]] = {}
        for record in result.records:
            if record.get("_t") != "publish_event":
                continue
            tag = record.get("tag")
            if not isinstance(tag, str):
                continue
            published[tag] = {
                "published_at": str(record.get("published_at") or ""),
                "github_release_url": str(record.get("github_release_url") or ""),
                "delivery_status": str(record.get("delivery_status") or ""),
            }
        return published


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
        for relative in [CAPABILITY_VERSIONS_FILE, MODEL_VERSIONS_FILE, PUBLISH_EVENTS_FILE]:
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
        for relative in [CAPABILITY_VERSIONS_FILE, MODEL_VERSIONS_FILE, PUBLISH_EVENTS_FILE]:
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
        self.releases = ReleaseAppService(self.context)
        self.diagnostics = DiagnosticsService(self.context)
        self.audit = AuditService(self.context)


def _validate_release_version(version: str) -> str:
    normalized = version.strip()
    if not RELEASE_VERSION_RE.match(normalized):
        raise AppError(
            "RELEASE_INVALID_VERSION",
            'Release version must use the form "X.Y.Z".',
        )
    return normalized


def _validate_release_tag(tag: str) -> str:
    normalized = tag.strip()
    if not RELEASE_TAG_RE.match(normalized):
        raise AppError(
            "RELEASE_INVALID_VERSION",
            'Release tag must use the form "ecm-vX.Y.Z".',
        )
    return normalized


def _release_tag(version: str) -> str:
    return f"ecm-v{version}"


def _release_blocker(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


def _raise_release_blocker(blocker: dict[str, str]) -> None:
    raise AppError(blocker["code"], blocker["message"])


def _remote_status(remote_url: str | None) -> dict[str, Any] | None:
    if remote_url is None:
        return None
    return {
        "name": "origin",
        "url": remote_url,
        "host": None,
        "owner": None,
        "repo": None,
        "is_github": False,
    }


def _relative_path(root: Path, path: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


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
