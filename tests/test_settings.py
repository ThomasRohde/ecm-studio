from __future__ import annotations

from pathlib import Path

from ecm_studio.desktop.theme import apply_windows_chrome_theme
from ecm_studio.infrastructure.settings import SettingsRepository, resolve_theme


def test_settings_persist_theme_and_recent_workspaces(tmp_path: Path) -> None:
    repo = SettingsRepository(tmp_path / "settings.json")

    initial = repo.load()
    assert initial.theme_mode == "system"
    assert initial.resolved_theme in {"light", "dark"}

    updated = repo.update(theme_mode="dark")
    assert updated.to_dict()["resolved_theme"] == "dark"

    repo.add_recent_workspace(tmp_path / "workspace")
    reloaded = repo.load()

    assert reloaded.theme_mode == "dark"
    assert reloaded.recent_workspaces == [str((tmp_path / "workspace").resolve())]


def test_system_theme_resolution_has_safe_fallback() -> None:
    assert resolve_theme("light") == "light"
    assert resolve_theme("dark") == "dark"
    assert resolve_theme("system") in {"light", "dark"}


def test_windows_chrome_theme_noops_without_window_handle() -> None:
    assert apply_windows_chrome_theme(object(), "dark") is False
