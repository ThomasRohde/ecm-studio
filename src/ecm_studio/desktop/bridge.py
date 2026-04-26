from __future__ import annotations

import webbrowser
from pathlib import Path
from typing import Any

import webview

from ecm_studio import __version__
from ecm_studio.application.results import envelope
from ecm_studio.application.services import AppServices
from ecm_studio.desktop.theme import apply_windows_chrome_theme
from ecm_studio.domain.errors import ValidationFailed
from ecm_studio.infrastructure.jsonl import atomic_write_text

MAP_EXPORT_EXTENSIONS = {"svg": ".svg", "html": ".html"}


class BridgeApi:
    def __init__(self, services: AppServices) -> None:
        self._services = services
        self._window: Any | None = None

    def attach_window(self, window: Any) -> None:
        self._window = window

    @envelope
    def app_info(self) -> dict[str, str]:
        return {"name": "ECM Studio", "version": __version__}

    @envelope
    def settings_get(self) -> dict[str, Any]:
        settings = self._services.settings.get()
        self._apply_chrome(settings)
        return settings

    @envelope
    def settings_update(self, patch: dict[str, Any]) -> dict[str, Any]:
        settings = self._services.settings.update(patch)
        self._apply_chrome(settings)
        return settings

    @envelope
    def workspace_open(self, path: str | None = None) -> dict[str, Any]:
        return self._services.workspace.open(path)

    @envelope
    def workspace_init(self, path: str, name: str) -> dict[str, Any]:
        return self._services.workspace.init(path, name)

    @envelope
    def workspace_status(self) -> dict[str, Any]:
        return self._services.workspace.status()

    @envelope
    def workspace_rebuild_index(self) -> dict[str, Any]:
        return self._services.workspace.rebuild_index()

    @envelope
    def workspace_update_settings(self, patch: dict[str, Any]) -> dict[str, Any]:
        return self._services.workspace.update_settings(patch)

    @envelope
    def workspace_pick_open(self) -> dict[str, Any] | None:
        path = self._pick_folder()
        if path is None:
            return None
        return self._services.workspace.open(path)

    @envelope
    def workspace_pick_init(self, name: str = "") -> dict[str, Any] | None:
        path = self._pick_folder()
        if path is None:
            return None
        return self._services.workspace.init(path, name or Path(path).name)

    @envelope
    def capabilities_list_tree(self) -> list[dict[str, Any]]:
        return self._services.capabilities.list_tree()

    @envelope
    def capabilities_get(self, capability_id: str) -> dict[str, Any]:
        return self._services.capabilities.get(capability_id)

    @envelope
    def capabilities_create(self, input_data: dict[str, Any]) -> dict[str, Any]:
        return self._services.capabilities.create(input_data)

    @envelope
    def capabilities_update(self, capability_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        return self._services.capabilities.update(capability_id, patch)

    @envelope
    def capabilities_save(
        self,
        capability_id: str,
        patch: dict[str, Any],
        new_parent_id: str | None,
        order: int | None = None,
    ) -> dict[str, Any]:
        return self._services.capabilities.save(capability_id, patch, new_parent_id, order)

    @envelope
    def capabilities_move(
        self, capability_id: str, new_parent_id: str | None, order: int | None = None
    ) -> dict[str, Any]:
        return self._services.capabilities.move(capability_id, new_parent_id, order)

    @envelope
    def capabilities_export(self, format_name: str) -> dict[str, Any]:
        return self._services.capabilities.export(format_name)

    @envelope
    def models_import_preview(
        self, source_path: str | None = None, mode: str = "validate_only"
    ) -> dict[str, Any] | None:
        source = source_path or self._pick_import_file()
        if source is None:
            return None
        return self._services.models.import_preview(source, mode)

    @envelope
    def models_import_apply(self, source_path: str, mode: str) -> dict[str, Any]:
        return self._services.models.import_apply(source_path, mode)

    @envelope
    def models_export(
        self, format_name: str, target_path: str | None = None
    ) -> dict[str, Any] | None:
        target = target_path if target_path else self._pick_export_file(format_name)
        if target is None:
            return None
        return self._services.models.export(format_name, target)

    @envelope
    def map_export(
        self,
        format_name: str,
        content: str,
        suggested_filename: str = "",
    ) -> dict[str, Any] | None:
        format_value = _map_export_format(format_name)
        target = self._pick_map_export_file(format_value, suggested_filename)
        if target is None:
            return None
        path = write_map_export(format_value, Path(target), content)
        return {"format": format_value, "path": str(path)}

    @envelope
    def search_query(self, q: str, filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        return self._services.search.query(q, filters)

    @envelope
    def git_status(self) -> dict[str, Any]:
        return self._services.git.status()

    @envelope
    def git_checkpoint(self, message: str) -> dict[str, Any]:
        return self._services.git.checkpoint(message)

    @envelope
    def git_history(self, limit: int = 50) -> list[dict[str, Any]]:
        return self._services.git.history(limit)

    @envelope
    def git_graph(self, limit: int = 50) -> dict[str, Any]:
        return self._services.git.graph(limit)

    @envelope
    def git_compare(self, from_ref: str, to_ref: str) -> dict[str, Any]:
        return self._services.git.compare(from_ref, to_ref)

    @envelope
    def git_restore(self, checkpoint_id: str, force: bool = False) -> dict[str, Any]:
        return self._services.git.restore(checkpoint_id, force=force)

    @envelope
    def git_list_branches(self) -> list[str]:
        return self._services.git.list_branches()

    @envelope
    def git_integration_candidates(self) -> list[dict[str, Any]]:
        return self._services.git.integration_candidates()

    @envelope
    def git_create_branch(self, name: str) -> dict[str, Any]:
        return self._services.git.create_branch(name)

    @envelope
    def git_switch_branch(self, name: str) -> dict[str, Any]:
        return self._services.git.switch_branch(name)

    @envelope
    def git_merge_branch(self, source_branch: str) -> dict[str, Any]:
        return self._services.git.merge_branch(source_branch)

    @envelope
    def git_abort_merge(self) -> dict[str, Any]:
        return self._services.git.abort_merge()

    @envelope
    def git_pull(self) -> dict[str, Any]:
        return self._services.git.pull()

    @envelope
    def git_push(self) -> dict[str, Any]:
        return self._services.git.push()

    @envelope
    def releases_status(self) -> dict[str, Any]:
        return self._services.releases.status()

    @envelope
    def releases_cut(self, version: str, notes: str | None = None) -> dict[str, Any]:
        return self._services.releases.cut(version, notes)

    @envelope
    def releases_publish(self, tag: str) -> dict[str, Any]:
        return self._services.releases.publish(tag)

    @envelope
    def diagnostics_run(self) -> list[dict[str, Any]]:
        return self._services.diagnostics.run()

    @envelope
    def audit_recent(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._services.audit.recent(limit)

    @envelope
    def external_open_url(self, url: str) -> dict[str, Any]:
        if not url.startswith(("https://", "http://")):
            raise ValidationFailed("Only HTTP and HTTPS URLs can be opened externally.")
        opened = webbrowser.open(url, new=1)
        return {"opened": opened, "url": url}

    @envelope
    def dialog_pick_workspace(self) -> str | None:
        return self._pick_folder()

    def _open_initial_workspace(self, workspace: Path | None) -> None:
        if workspace is not None:
            self._services.workspace.open(str(workspace))

    def _pick_folder(self) -> str | None:
        if self._window is None:
            return None
        selection = self._window.create_file_dialog(
            webview.FileDialog.FOLDER, allow_multiple=False
        )
        return _first_selection(selection)

    def _pick_import_file(self) -> str | None:
        if self._window is None:
            return None
        selection = self._window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=False,
            file_types=(
                "ECM models (*.jsonl;*.json;*.csv)",
                "JSONL (*.jsonl)",
                "CSV (*.csv)",
                "JSON (*.json)",
            ),
        )
        return _first_selection(selection)

    def _pick_export_file(self, format_name: str) -> str | None:
        if self._window is None:
            return None
        filename = {
            "jsonl": "capabilities.jsonl",
            "csv": "capabilities.csv",
            "json": "capabilities.bundle.json",
            "json_bundle": "capabilities.bundle.json",
        }.get(format_name, "capabilities.jsonl")
        selection = self._window.create_file_dialog(
            webview.FileDialog.SAVE,
            allow_multiple=False,
            save_filename=filename,
            file_types=("ECM model (*.*)",),
        )
        return _first_selection(selection)

    def _pick_map_export_file(self, format_name: str, suggested_filename: str) -> str | None:
        if self._window is None:
            return None
        filename = map_export_filename(format_name, suggested_filename)
        file_type = "SVG (*.svg)" if format_name == "svg" else "HTML (*.html)"
        selection = self._window.create_file_dialog(
            webview.FileDialog.SAVE,
            allow_multiple=False,
            save_filename=filename,
            file_types=(file_type, "All files (*.*)"),
        )
        return _first_selection(selection)

    def _apply_chrome(self, settings: dict[str, Any]) -> None:
        if self._window is None:
            return
        resolved = settings.get("resolved_theme")
        if resolved in {"light", "dark"}:
            apply_windows_chrome_theme(self._window, resolved)


def _first_selection(selection: Any) -> str | None:
    if not selection:
        return None
    if isinstance(selection, str):
        return selection
    return str(selection[0]) if selection else None


def write_map_export(format_name: str, target_path: Path, content: str) -> Path:
    format_value = _map_export_format(format_name)
    if not isinstance(content, str):
        raise ValidationFailed("Map export content must be text.")
    path = map_export_target_path(format_value, target_path)
    atomic_write_text(path, content)
    return path


def map_export_filename(format_name: str, suggested_filename: str = "") -> str:
    format_value = _map_export_format(format_name)
    extension = MAP_EXPORT_EXTENSIONS[format_value]
    raw_name = Path(str(suggested_filename or f"capability-map{extension}")).name
    if not raw_name or raw_name in {".", ".."}:
        raw_name = f"capability-map{extension}"
    return map_export_target_path(format_value, Path(raw_name)).name


def map_export_target_path(format_name: str, target_path: Path) -> Path:
    format_value = _map_export_format(format_name)
    extension = MAP_EXPORT_EXTENSIONS[format_value]
    if target_path.suffix.lower() == extension:
        return target_path
    if target_path.suffix:
        return target_path.with_suffix(extension)
    return target_path.with_name(f"{target_path.name}{extension}")


def _map_export_format(format_name: str) -> str:
    if format_name in MAP_EXPORT_EXTENSIONS:
        return format_name
    raise ValidationFailed("Map export format must be svg or html.")
