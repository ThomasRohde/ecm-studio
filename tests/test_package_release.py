from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_release_helper_dry_run_reports_release_steps() -> None:
    result = subprocess.run(
        [sys.executable, "scripts/release.py", "9.8.7", "--dry"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert "would bump" in result.stdout
    assert "would rename `## [Unreleased]` -> `## [9.8.7]" in result.stdout
    assert "would commit + tag v9.8.7" in result.stdout


def test_release_helper_dry_run_rejects_invalid_release_version() -> None:
    result = subprocess.run(
        [sys.executable, "scripts/release.py", "9.8", "--dry"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )

    assert result.returncode != 0
    assert "Refusing non-release version: '9.8'" in result.stderr
