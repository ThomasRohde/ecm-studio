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
                "layout_density": "compact",
                "alignment": "right",
                "color_scheme": {
                    "depth_colors": ["#112233", "#445566"],
                    "leaf_color": "#778899",
                },
            }
        }
    )

    assert result["ok"] is True
    assert result["data"]["settings"]["capability_map"]["target_aspect_ratio"] == 1.5
    assert result["data"]["settings"]["capability_map"]["layout_density"] == "compact"
    assert result["data"]["settings"]["capability_map"]["alignment"] == "right"
    assert result["data"]["settings"]["capability_map"]["color_scheme"] == {
        "depth_colors": ["#112233", "#445566"],
        "leaf_color": "#778899",
    }


def test_bridge_discards_pending_changes_and_rebuilds_index(tmp_path: Path) -> None:
    api = BridgeApi(AppServices(settings_path=tmp_path / "settings.json"))
    workspace_path = tmp_path / "workspace"
    api.workspace_init(str(workspace_path), "Discard")
    api.git_checkpoint("Initial")

    capabilities = workspace_path / "ecm" / "capabilities.jsonl"
    capabilities.write_text("dirty\n", encoding="utf-8")
    scratch = workspace_path / "scratch.txt"
    scratch.write_text("scratch\n", encoding="utf-8")

    result = api.git_discard_pending_changes()

    assert result["ok"] is True
    assert result["data"]["rebuild"]["capability_count"] == 0
    assert result["data"]["deleted_files"] == ["scratch.txt"]
    assert capabilities.read_text(encoding="utf-8") == ""
    assert not scratch.exists()
