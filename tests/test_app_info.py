from __future__ import annotations

from pathlib import Path

from ecm_studio import __version__
from ecm_studio.application.services import AppServices
from ecm_studio.desktop.bridge import BridgeApi


def test_bridge_app_info_returns_package_version(tmp_path: Path) -> None:
    api = BridgeApi(AppServices(settings_path=tmp_path / "settings.json"))

    result = api.app_info()

    assert result == {"ok": True, "data": {"name": "ECM Studio", "version": __version__}}


def test_bridge_updates_workspace_settings(tmp_path: Path) -> None:
    api = BridgeApi(AppServices(settings_path=tmp_path / "settings.json"))
    api.workspace_init(str(tmp_path / "workspace"), "Bridge")

    result = api.workspace_update_settings(
        {
            "capability_map": {
                "target_aspect_ratio": 1.5,
                "color_scheme": {
                    "depth_colors": ["#112233", "#445566"],
                    "leaf_color": "#778899",
                },
            }
        }
    )

    assert result["ok"] is True
    assert result["data"]["settings"]["capability_map"]["target_aspect_ratio"] == 1.5
    assert result["data"]["settings"]["capability_map"]["color_scheme"] == {
        "depth_colors": ["#112233", "#445566"],
        "leaf_color": "#778899",
    }
