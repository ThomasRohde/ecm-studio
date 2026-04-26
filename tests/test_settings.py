from __future__ import annotations

import json
from pathlib import Path

import pytest

from ecm_studio.application.services import AppServices
from ecm_studio.desktop.theme import apply_windows_chrome_theme
from ecm_studio.domain.errors import ValidationFailed
from ecm_studio.domain.models import (
    DEFAULT_CAPABILITY_MAP_DEPTH_COLORS,
    DEFAULT_CAPABILITY_MAP_LEAF_COLOR,
    DEFAULT_CAPABILITY_MAP_TARGET_ASPECT_RATIO,
)
from ecm_studio.infrastructure.settings import SettingsRepository, resolve_theme
from ecm_studio.infrastructure.workspace import WorkspaceRepository


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


def test_workspace_config_defaults_repository_settings(tmp_path: Path) -> None:
    workspace = WorkspaceRepository(tmp_path)
    workspace.init("Repository Settings")

    config = workspace.load_config()
    assert (
        config.settings.capability_map.target_aspect_ratio
        == DEFAULT_CAPABILITY_MAP_TARGET_ASPECT_RATIO
    )
    assert (
        config.settings.capability_map.color_scheme.depth_colors
        == DEFAULT_CAPABILITY_MAP_DEPTH_COLORS
    )
    assert (
        config.settings.capability_map.color_scheme.leaf_color
        == DEFAULT_CAPABILITY_MAP_LEAF_COLOR
    )

    raw = json.loads((tmp_path / "ecm-studio.json").read_text(encoding="utf-8"))
    assert (
        raw["settings"]["capability_map"]["target_aspect_ratio"]
        == DEFAULT_CAPABILITY_MAP_TARGET_ASPECT_RATIO
    )
    assert (
        raw["settings"]["capability_map"]["color_scheme"]["depth_colors"]
        == DEFAULT_CAPABILITY_MAP_DEPTH_COLORS
    )
    assert (
        raw["settings"]["capability_map"]["color_scheme"]["leaf_color"]
        == DEFAULT_CAPABILITY_MAP_LEAF_COLOR
    )


def test_workspace_config_reads_legacy_config_without_settings(tmp_path: Path) -> None:
    workspace = WorkspaceRepository(tmp_path)
    (tmp_path / "ecm").mkdir()
    (tmp_path / "ecm-studio.json").write_text(
        json.dumps(
            {
                "_t": "workspace",
                "schema_version": "1.0",
                "name": "Legacy",
                "created_at": "2026-04-25T00:00:00Z",
                "updated_at": "2026-04-25T00:00:00Z",
            }
        ),
        encoding="utf-8",
    )

    config = workspace.load_config()

    assert (
        config.settings.capability_map.target_aspect_ratio
        == DEFAULT_CAPABILITY_MAP_TARGET_ASPECT_RATIO
    )
    assert (
        config.settings.capability_map.color_scheme.depth_colors
        == DEFAULT_CAPABILITY_MAP_DEPTH_COLORS
    )
    assert (
        config.settings.capability_map.color_scheme.leaf_color
        == DEFAULT_CAPABILITY_MAP_LEAF_COLOR
    )


def test_workspace_settings_update_persists_tracked_config(tmp_path: Path) -> None:
    services = AppServices(settings_path=tmp_path / "settings.json")
    workspace_root = tmp_path / "workspace"
    services.workspace.init(str(workspace_root), "Settings")

    updated = services.workspace.update_settings(
        {"capability_map": {"target_aspect_ratio": 4 / 3}}
    )

    assert updated["settings"]["capability_map"]["target_aspect_ratio"] == 4 / 3
    raw = json.loads((workspace_root / "ecm-studio.json").read_text(encoding="utf-8"))
    assert raw["settings"]["capability_map"]["target_aspect_ratio"] == 4 / 3


def test_workspace_settings_update_persists_color_scheme(tmp_path: Path) -> None:
    services = AppServices(settings_path=tmp_path / "settings.json")
    workspace_root = tmp_path / "workspace"
    services.workspace.init(str(workspace_root), "Settings")

    updated = services.workspace.update_settings(
        {
            "capability_map": {
                "color_scheme": {
                    "depth_colors": ["#112233", "#445566"],
                    "leaf_color": "#778899",
                }
            }
        }
    )

    color_scheme = updated["settings"]["capability_map"]["color_scheme"]
    assert color_scheme["depth_colors"] == ["#112233", "#445566"]
    assert color_scheme["leaf_color"] == "#778899"
    raw = json.loads((workspace_root / "ecm-studio.json").read_text(encoding="utf-8"))
    assert raw["settings"]["capability_map"]["color_scheme"] == color_scheme


def test_workspace_settings_color_scheme_patch_preserves_existing_values(
    tmp_path: Path,
) -> None:
    services = AppServices(settings_path=tmp_path / "settings.json")
    services.workspace.init(str(tmp_path / "workspace"), "Settings")
    services.workspace.update_settings(
        {
            "capability_map": {
                "color_scheme": {
                    "depth_colors": ["#112233", "#445566"],
                    "leaf_color": "#778899",
                }
            }
        }
    )

    updated = services.workspace.update_settings(
        {"capability_map": {"color_scheme": {"leaf_color": "#AABBCC"}}}
    )

    color_scheme = updated["settings"]["capability_map"]["color_scheme"]
    assert color_scheme["depth_colors"] == ["#112233", "#445566"]
    assert color_scheme["leaf_color"] == "#AABBCC"


def test_workspace_settings_reject_invalid_aspect_ratio(tmp_path: Path) -> None:
    services = AppServices(settings_path=tmp_path / "settings.json")
    services.workspace.init(str(tmp_path / "workspace"), "Settings")

    with pytest.raises(ValidationFailed):
        services.workspace.update_settings(
            {"capability_map": {"target_aspect_ratio": 4.5}}
        )


@pytest.mark.parametrize(
    "color_scheme",
    [
        {"depth_colors": [], "leaf_color": "#778899"},
        {
            "depth_colors": [
                "#000001",
                "#000002",
                "#000003",
                "#000004",
                "#000005",
                "#000006",
                "#000007",
                "#000008",
                "#000009",
            ],
            "leaf_color": "#778899",
        },
        {"depth_colors": ["#11223"], "leaf_color": "#778899"},
        {"depth_colors": ["#112233"], "leaf_color": "778899"},
    ],
)
def test_workspace_settings_reject_invalid_color_scheme(
    tmp_path: Path,
    color_scheme: dict[str, object],
) -> None:
    services = AppServices(settings_path=tmp_path / "settings.json")
    services.workspace.init(str(tmp_path / "workspace"), "Settings")

    with pytest.raises(ValidationFailed):
        services.workspace.update_settings(
            {"capability_map": {"color_scheme": color_scheme}}
        )
