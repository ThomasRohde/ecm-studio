from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from ecm_studio.application.services import AppServices
from ecm_studio.desktop.bridge import (
    BridgeApi,
    map_export_filename,
    map_export_target_path,
    write_map_export,
)
from ecm_studio.domain.errors import ValidationFailed


def test_map_export_filename_defaults_and_extensions() -> None:
    assert map_export_filename("svg") == "capability-map.svg"
    assert map_export_filename("html", "custom") == "custom.html"
    assert map_export_filename("svg", "custom.txt") == "custom.svg"
    assert map_export_filename("html", "../nested/map.svg") == "map.html"


def test_map_export_rejects_invalid_format(tmp_path: Path) -> None:
    with pytest.raises(ValidationFailed):
        map_export_target_path("pdf", tmp_path / "map.pdf")


def test_write_map_export_writes_utf8_and_normalizes_extension(tmp_path: Path) -> None:
    written = write_map_export("svg", tmp_path / "capability-map.txt", "<svg>æøå</svg>")

    assert written == tmp_path / "capability-map.svg"
    assert written.read_text(encoding="utf-8") == "<svg>æøå</svg>"


def test_bridge_map_export_uses_save_dialog_and_writes_file(tmp_path: Path) -> None:
    target = tmp_path / "picked-name"
    window = FakeWindow(str(target))
    bridge = BridgeApi(AppServices(settings_path=tmp_path / "settings.json"))
    bridge.attach_window(window)

    result = bridge.map_export("html", "<html>ok</html>", "custom-name")

    assert result["ok"] is True
    data = result["data"]
    assert data["format"] == "html"
    assert data["path"] == str(tmp_path / "picked-name.html")
    assert Path(data["path"]).read_text(encoding="utf-8") == "<html>ok</html>"
    assert window.calls[0]["save_filename"] == "custom-name.html"


def test_bridge_map_export_returns_none_when_dialog_is_cancelled(tmp_path: Path) -> None:
    window = FakeWindow(None)
    bridge = BridgeApi(AppServices(settings_path=tmp_path / "settings.json"))
    bridge.attach_window(window)

    result = bridge.map_export("svg", "<svg />", "capability-map.svg")

    assert result == {"ok": True, "data": None}


class FakeWindow:
    def __init__(self, selection: str | None) -> None:
        self.selection = selection
        self.calls: list[dict[str, Any]] = []

    def create_file_dialog(self, *args: Any, **kwargs: Any) -> str | None:
        self.calls.append(kwargs)
        return self.selection
