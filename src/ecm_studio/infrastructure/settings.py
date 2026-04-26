from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Literal

from platformdirs import user_config_dir
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from ecm_studio.domain.models import SCHEMA_VERSION

ThemeMode = Literal["system", "light", "dark"]
ResolvedTheme = Literal["light", "dark"]
_UNSET = object()


class AppSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0"] = SCHEMA_VERSION
    theme_mode: ThemeMode = "system"
    recent_workspaces: list[str] = Field(default_factory=list)
    view_setup: dict[str, Any] | None = None

    @property
    def resolved_theme(self) -> ResolvedTheme:
        return resolve_theme(self.theme_mode)

    def to_dict(self) -> dict:
        return {
            "schema_version": self.schema_version,
            "theme_mode": self.theme_mode,
            "resolved_theme": self.resolved_theme,
            "recent_workspaces": self.recent_workspaces,
            "view_setup": self.view_setup,
        }


def resolve_theme(theme_mode: ThemeMode) -> ResolvedTheme:
    if theme_mode in {"light", "dark"}:
        return theme_mode
    return read_windows_theme() or "light"


def read_windows_theme() -> ResolvedTheme | None:
    if sys.platform != "win32":
        return None
    try:
        import winreg

        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
        ) as key:
            value, _ = winreg.QueryValueEx(key, "AppsUseLightTheme")
    except OSError:
        return None
    return "light" if int(value) else "dark"


class SettingsRepository:
    def __init__(self, path: Path | None = None, legacy_path: Path | None = None) -> None:
        self.path = path or Path.home() / ".ecms" / "settings.json"
        self.legacy_path = legacy_path if legacy_path is not None else (
            _legacy_settings_path() if path is None else None
        )

    def load(self) -> AppSettings:
        if not self.path.exists():
            if self.legacy_path is not None and self.legacy_path.exists():
                return self._load_from(self.legacy_path)
            return AppSettings()
        return self._load_from(self.path)

    def _load_from(self, path: Path) -> AppSettings:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            return AppSettings.model_validate(raw)
        except (OSError, json.JSONDecodeError, ValidationError):
            return AppSettings()

    def save(self, settings: AppSettings) -> AppSettings:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        content = json.dumps(
            settings.model_dump(mode="json"),
            ensure_ascii=False,
            sort_keys=True,
            indent=2,
        )
        self.path.write_text(content + "\n", encoding="utf-8", newline="\n")
        return settings

    def update(
        self,
        theme_mode: ThemeMode | None = None,
        view_setup: dict[str, Any] | None | object = _UNSET,
    ) -> AppSettings:
        settings = self.load()
        data = settings.model_dump(mode="json")
        if theme_mode is not None:
            data["theme_mode"] = theme_mode
        if view_setup is not _UNSET:
            data["view_setup"] = view_setup
        return self.save(AppSettings.model_validate(data))

    def add_recent_workspace(self, path: Path) -> AppSettings:
        settings = self.load()
        normalized = str(path.resolve())
        recent = [item for item in settings.recent_workspaces if item.lower() != normalized.lower()]
        recent.insert(0, normalized)
        data = settings.model_dump(mode="json")
        data["recent_workspaces"] = recent[:10]
        return self.save(AppSettings.model_validate(data))


def _legacy_settings_path() -> Path:
    return Path(user_config_dir("ECM Studio", appauthor=False)) / "settings.json"
