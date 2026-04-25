from __future__ import annotations

import ctypes
import logging
import sys
import tempfile
from pathlib import Path

import webview

from ecm_studio.application.services import AppServices

from .bridge import BridgeApi

for _name in ("pywebview", "pywebview.util", "pywebview.platforms.edgechromium", "webview"):
    logging.getLogger(_name).setLevel(logging.CRITICAL)


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _ui_index() -> Path:
    packaged = Path(__file__).resolve().parents[1] / "assets" / "ui" / "index.html"
    if packaged.exists():
        return packaged
    source = _project_root() / "ui" / "dist" / "index.html"
    if source.exists():
        return source
    return _fallback_page()


def _app_icon() -> Path | None:
    packaged = Path(__file__).resolve().parents[1] / "assets" / "ecm-studio.ico"
    if packaged.exists():
        return packaged
    source = _project_root() / "packaging" / "assets" / "ecm-studio.ico"
    if source.exists():
        return source
    return None


def _set_windows_app_id() -> None:
    if sys.platform != "win32":
        return
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("ecm-studio.ecm-studio")
    except Exception:
        return


def _fallback_page() -> Path:
    html = """
<!doctype html>
<html><head><meta charset="utf-8"><title>ECM Studio</title></head>
<body style="font-family:Segoe UI,sans-serif;margin:40px">
<h1>ECM Studio</h1>
<p>UI assets are not built yet. Run <code>cd ui && npm install && npm run build</code>.</p>
</body></html>
""".strip()
    directory = Path(tempfile.mkdtemp(prefix="ecms-"))
    index = directory / "index.html"
    index.write_text(html, encoding="utf-8")
    return index


def run(workspace: Path | None = None, dev_ui: str | None = None) -> int:
    _set_windows_app_id()
    services = AppServices()
    api = BridgeApi(services)
    if workspace is not None:
        api._open_initial_workspace(workspace)
    url = dev_ui or _ui_index().as_uri()
    settings = services.settings.get()
    background_color = "#101418" if settings["resolved_theme"] == "dark" else "#f6f4ef"
    window = webview.create_window(
        title="ECM Studio",
        url=url,
        js_api=api,
        width=1320,
        height=860,
        min_size=(900, 600),
        background_color=background_color,
    )
    api.attach_window(window)

    def _apply_initial_theme() -> None:
        api.settings_get()

    window.events.loaded += _apply_initial_theme
    icon = _app_icon()
    webview.start(icon=str(icon) if icon is not None else None)
    return 0
