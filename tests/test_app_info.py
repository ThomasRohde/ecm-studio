from __future__ import annotations

from pathlib import Path

from ecm_studio import __version__
from ecm_studio.application.services import AppServices
from ecm_studio.desktop.bridge import BridgeApi


def test_bridge_app_info_returns_package_version(tmp_path: Path) -> None:
    api = BridgeApi(AppServices(settings_path=tmp_path / "settings.json"))

    result = api.app_info()

    assert result == {"ok": True, "data": {"name": "ECM Studio", "version": __version__}}
