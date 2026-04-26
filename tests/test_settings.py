from __future__ import annotations

import json
from pathlib import Path

from ecm_studio.desktop.theme import apply_windows_chrome_theme
from ecm_studio.infrastructure.settings import SettingsRepository, resolve_theme


def test_settings_persist_theme_and_recent_workspaces(tmp_path: Path) -> None:
    repo = SettingsRepository(tmp_path / ".ecms" / "settings.json")
    view_setup = {
        "grid": {"root": "workspace"},
        "panels": {"workspace": {"id": "workspace", "contentComponent": "workspace"}},
    }

    initial = repo.load()
    assert initial.theme_mode == "system"
    assert initial.resolved_theme in {"light", "dark"}
    assert initial.view_setup is None

    updated = repo.update(theme_mode="dark", view_setup=view_setup)
    assert updated.to_dict()["resolved_theme"] == "dark"

    repo.add_recent_workspace(tmp_path / "workspace")
    reloaded = repo.load()

    assert reloaded.theme_mode == "dark"
    assert reloaded.recent_workspaces == [str((tmp_path / "workspace").resolve())]
    assert reloaded.view_setup == view_setup

    cleared = repo.update(view_setup=None)
    assert cleared.view_setup is None


def test_settings_reads_legacy_path_when_new_file_is_missing(tmp_path: Path) -> None:
    new_path = tmp_path / ".ecms" / "settings.json"
    legacy_path = tmp_path / "legacy" / "settings.json"
    legacy_path.parent.mkdir(parents=True)
    legacy_settings = {
        "schema_version": "1.0",
        "theme_mode": "dark",
        "recent_workspaces": [str(tmp_path / "workspace")],
        "view_setup": {
            "grid": {"root": "workspace"},
            "panels": {"workspace": {"id": "workspace", "contentComponent": "workspace"}},
        },
    }
    legacy_path.write_text(json.dumps(legacy_settings), encoding="utf-8")

    repo = SettingsRepository(new_path, legacy_path=legacy_path)
    loaded = repo.load()

    assert loaded.theme_mode == "dark"
    assert loaded.recent_workspaces == legacy_settings["recent_workspaces"]
    assert loaded.view_setup == legacy_settings["view_setup"]

    repo.update(theme_mode="light")

    assert new_path.exists()
    assert json.loads(new_path.read_text(encoding="utf-8"))["theme_mode"] == "light"
    assert legacy_path.exists()


def test_system_theme_resolution_has_safe_fallback() -> None:
    assert resolve_theme("light") == "light"
    assert resolve_theme("dark") == "dark"
    assert resolve_theme("system") in {"light", "dark"}


def test_windows_chrome_theme_noops_without_window_handle() -> None:
    assert apply_windows_chrome_theme(object(), "dark") is False
