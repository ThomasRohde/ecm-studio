from __future__ import annotations

from pathlib import Path

from ecm_studio.desktop.windows_shortcut import (
    APP_USER_MODEL_ID,
    SHORTCUT_NAME,
    build_windows_shortcut_spec,
)


def test_windows_shortcut_spec_prefers_installed_launcher(tmp_path: Path) -> None:
    launcher = tmp_path / "Scripts" / "ecms.exe"
    icon = tmp_path / "ecm-studio.ico"
    appdata = tmp_path / "AppData" / "Roaming"

    spec = build_windows_shortcut_spec(
        icon,
        appdata=str(appdata),
        executable=str(tmp_path / "Python" / "python.exe"),
        frozen=False,
        launcher=str(launcher),
    )

    assert spec is not None
    assert (
        spec.path
        == appdata / "Microsoft" / "Windows" / "Start Menu" / "Programs" / SHORTCUT_NAME
    )
    assert spec.target == launcher
    assert spec.arguments == ""
    assert spec.icon_path == icon
    assert spec.app_user_model_id == APP_USER_MODEL_ID


def test_windows_shortcut_spec_falls_back_to_python_module(tmp_path: Path) -> None:
    executable = tmp_path / "Python" / "python.exe"
    appdata = tmp_path / "AppData" / "Roaming"

    spec = build_windows_shortcut_spec(
        None,
        appdata=str(appdata),
        executable=str(executable),
        frozen=False,
        launcher="",
    )

    assert spec is not None
    assert spec.target == executable
    assert spec.arguments == "-m ecm_studio"
    assert spec.icon_path is None


def test_windows_shortcut_spec_uses_frozen_executable(tmp_path: Path) -> None:
    executable = tmp_path / "dist" / "ecms.exe"
    appdata = tmp_path / "AppData" / "Roaming"

    spec = build_windows_shortcut_spec(
        None,
        appdata=str(appdata),
        executable=str(executable),
        frozen=True,
        launcher=str(tmp_path / "Scripts" / "ecms.exe"),
    )

    assert spec is not None
    assert spec.target == executable
    assert spec.arguments == ""
