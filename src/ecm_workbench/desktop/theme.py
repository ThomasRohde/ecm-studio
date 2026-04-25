from __future__ import annotations

import ctypes
import sys
from typing import Any, Literal

ResolvedTheme = Literal["light", "dark"]

DWMWA_USE_IMMERSIVE_DARK_MODE = 20
DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1 = 19


def apply_windows_chrome_theme(window: Any, resolved_theme: ResolvedTheme) -> bool:
    if sys.platform != "win32":
        return False
    hwnd = _window_hwnd(window)
    if hwnd is None:
        return False
    use_dark = ctypes.c_int(1 if resolved_theme == "dark" else 0)
    for attribute in (DWMWA_USE_IMMERSIVE_DARK_MODE, DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1):
        try:
            result = ctypes.windll.dwmapi.DwmSetWindowAttribute(
                ctypes.c_void_p(hwnd),
                ctypes.c_uint(attribute),
                ctypes.byref(use_dark),
                ctypes.sizeof(use_dark),
            )
        except (AttributeError, OSError, ValueError):
            continue
        if result == 0:
            return True
    return False


def _window_hwnd(window: Any) -> int | None:
    candidates = [
        ("native", "Handle"),
        ("native", "handle"),
        ("gui", "Handle"),
        ("gui", "handle"),
        ("hwnd",),
        ("handle",),
    ]
    for path in candidates:
        current = window
        for name in path:
            current = getattr(current, name, None)
            if current is None:
                break
        if current is None:
            continue
        try:
            return int(current)
        except (TypeError, ValueError):
            continue
    return None
