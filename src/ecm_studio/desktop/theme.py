from __future__ import annotations

import ctypes
import sys
from typing import Any, Literal

ResolvedTheme = Literal["light", "dark"]

DWMWA_USE_IMMERSIVE_DARK_MODE = 20
DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1 = 19
DWMWA_BORDER_COLOR = 34
DWMWA_CAPTION_COLOR = 35
DWMWA_TEXT_COLOR = 36

CHROME_COLORS: dict[ResolvedTheme, dict[int, str]] = {
    "light": {
        DWMWA_BORDER_COLOR: "#c8d8d3",
        DWMWA_CAPTION_COLOR: "#d6e4df",
        DWMWA_TEXT_COLOR: "#1f272c",
    },
    "dark": {
        DWMWA_BORDER_COLOR: "#1e3a3a",
        DWMWA_CAPTION_COLOR: "#0f1f2c",
        DWMWA_TEXT_COLOR: "#f3f6f8",
    },
}


def apply_windows_chrome_theme(window: Any, resolved_theme: ResolvedTheme) -> bool:
    if sys.platform != "win32":
        return False
    hwnd = _window_hwnd(window)
    if hwnd is None:
        return False
    applied = False
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
            applied = True
            break
    for attribute, color in CHROME_COLORS[resolved_theme].items():
        applied = _set_dwm_color(hwnd, attribute, color) or applied
    return applied


def _set_dwm_color(hwnd: int, attribute: int, color: str) -> bool:
    value = ctypes.c_uint(_colorref(color))
    try:
        result = ctypes.windll.dwmapi.DwmSetWindowAttribute(
            ctypes.c_void_p(hwnd),
            ctypes.c_uint(attribute),
            ctypes.byref(value),
            ctypes.sizeof(value),
        )
    except (AttributeError, OSError, ValueError):
        return False
    return result == 0


def _colorref(hex_color: str) -> int:
    red = int(hex_color[1:3], 16)
    green = int(hex_color[3:5], 16)
    blue = int(hex_color[5:7], 16)
    return red | (green << 8) | (blue << 16)


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
        handle = _coerce_hwnd(current)
        if handle is not None:
            return handle
    return None


def _coerce_hwnd(value: Any) -> int | None:
    for method_name in ("ToInt64", "ToInt32"):
        method = getattr(value, method_name, None)
        if method is None:
            continue
        try:
            return int(method())
        except (TypeError, ValueError):
            continue
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
