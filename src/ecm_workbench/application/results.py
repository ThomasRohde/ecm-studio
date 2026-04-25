from __future__ import annotations

from collections.abc import Callable
from typing import Any

from ecm_workbench.domain.errors import AppError


def ok(data: Any) -> dict[str, Any]:
    return {"ok": True, "data": data}


def err(exc: Exception) -> dict[str, Any]:
    if isinstance(exc, AppError):
        return {
            "ok": False,
            "error": {"code": exc.code, "message": exc.message, "detail": exc.detail},
        }
    return {
        "ok": False,
        "error": {"code": "UNEXPECTED_ERROR", "message": str(exc), "detail": None},
    }


def envelope[**P, T](fn: Callable[P, T]) -> Callable[P, dict[str, Any]]:
    def wrapped(*args: P.args, **kwargs: P.kwargs) -> dict[str, Any]:
        try:
            return ok(fn(*args, **kwargs))
        except Exception as exc:  # bridge boundary must not leak Python exceptions
            return err(exc)

    return wrapped
