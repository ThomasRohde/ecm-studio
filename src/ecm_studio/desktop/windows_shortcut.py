from __future__ import annotations

import logging
import os
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

APP_USER_MODEL_ID = "ecm-studio.ecm-studio"
SHORTCUT_NAME = "ECM Studio.lnk"

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ShortcutSpec:
    path: Path
    target: Path
    arguments: str
    working_directory: Path
    icon_path: Path | None
    app_user_model_id: str
    description: str = "ECM Studio"


def build_windows_shortcut_spec(
    icon_path: Path | None,
    *,
    appdata: str | None = None,
    executable: str | None = None,
    frozen: bool | None = None,
    launcher: str | None = None,
) -> ShortcutSpec | None:
    appdata_root = appdata or os.environ.get("APPDATA")
    if not appdata_root:
        return None

    target, arguments = _shortcut_target(
        executable=executable,
        frozen=frozen,
        launcher=launcher,
    )
    shortcut_dir = Path(appdata_root) / "Microsoft" / "Windows" / "Start Menu" / "Programs"
    return ShortcutSpec(
        path=shortcut_dir / SHORTCUT_NAME,
        target=target,
        arguments=arguments,
        working_directory=target.parent,
        icon_path=icon_path,
        app_user_model_id=APP_USER_MODEL_ID,
    )


def repair_windows_shortcut(icon_path: Path | None) -> None:
    if sys.platform != "win32":
        return
    spec = build_windows_shortcut_spec(icon_path)
    if spec is None:
        return
    try:
        _write_shortcut(spec)
    except Exception:
        logger.debug("Could not repair ECM Studio Start Menu shortcut.", exc_info=True)


def _shortcut_target(
    *,
    executable: str | None = None,
    frozen: bool | None = None,
    launcher: str | None = None,
) -> tuple[Path, str]:
    current_executable = executable or sys.executable
    is_frozen = bool(getattr(sys, "frozen", False)) if frozen is None else frozen
    if is_frozen:
        return Path(current_executable).resolve(), ""

    resolved_launcher = launcher if launcher is not None else shutil.which("ecms")
    if resolved_launcher:
        return Path(resolved_launcher).resolve(), ""

    return Path(current_executable).resolve(), "-m ecm_studio"


def _write_shortcut(spec: ShortcutSpec) -> None:
    spec.path.parent.mkdir(parents=True, exist_ok=True)

    import win32com.client  # type: ignore[import-not-found]

    shell = win32com.client.Dispatch("WScript.Shell")
    shortcut = shell.CreateShortcut(str(spec.path))
    shortcut.TargetPath = str(spec.target)
    shortcut.Arguments = spec.arguments
    shortcut.WorkingDirectory = str(spec.working_directory)
    shortcut.Description = spec.description
    if spec.icon_path is not None and spec.icon_path.exists():
        shortcut.IconLocation = f"{spec.icon_path},0"
    shortcut.Save()
    _set_shortcut_app_user_model_id(spec.path, spec.app_user_model_id)


def _set_shortcut_app_user_model_id(path: Path, app_user_model_id: str) -> None:
    from win32com.propsys import propsys, pscon  # type: ignore[import-not-found]

    property_store = propsys.SHGetPropertyStoreFromParsingName(str(path))
    property_store.SetValue(
        pscon.PKEY_AppUserModel_ID,
        propsys.PROPVARIANTType(app_user_model_id),
    )
    property_store.Commit()
