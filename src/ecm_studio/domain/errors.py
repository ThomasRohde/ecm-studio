from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


class AppError(Exception):
    def __init__(self, code: str, message: str, detail: Any | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail


class ValidationFailed(AppError):
    def __init__(self, message: str, detail: Any | None = None) -> None:
        super().__init__("VALIDATION_FAILED", message, detail)


class SettingsWriteFailed(AppError):
    def __init__(self, path: Path, cause: OSError) -> None:
        super().__init__(
            "SETTINGS_WRITE_FAILED",
            (
                f'Could not save app settings at "{path}". '
                "The file may be temporarily locked or not writable."
            ),
            {"path": str(path), "reason": str(cause)},
        )


class WorkspaceNotOpen(AppError):
    def __init__(self) -> None:
        super().__init__("WORKSPACE_NOT_OPEN", "No ECM workspace is open.")


class DuplicateName(AppError):
    def __init__(self, name: str) -> None:
        super().__init__("DUPLICATE_NAME", f'Capability name "{name}" already exists.')


class CycleDetected(AppError):
    def __init__(self) -> None:
        super().__init__("CYCLE_DETECTED", "Move would create a hierarchy cycle.")


class JsonlParseFailed(AppError):
    def __init__(self, detail: Any) -> None:
        super().__init__("JSONL_PARSE_FAILED", "JSONL parse or validation failed.", detail)


class DialogCancelled(AppError):
    def __init__(self) -> None:
        super().__init__("DIALOG_CANCELLED", "Dialog was cancelled.")


class ImportInvalid(AppError):
    def __init__(self, detail: Any) -> None:
        super().__init__("IMPORT_INVALID", "Import file failed validation.", detail)


class ImportUnsupportedFormat(AppError):
    def __init__(self, format_name: str) -> None:
        super().__init__(
            "IMPORT_UNSUPPORTED_FORMAT", f'Import format "{format_name}" is not supported.'
        )


@dataclass(frozen=True)
class Diagnostic:
    code: str
    message: str
    severity: str = "error"
    path: str | None = None
    line: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "severity": self.severity,
            "path": self.path,
            "line": self.line,
        }
