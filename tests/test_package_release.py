from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_pyinstaller_spec_bundles_agent_skills() -> None:
    spec = (ROOT / "packaging" / "ecms.spec").read_text(encoding="utf-8")

    assert 'root / ".agents" / "skills"' in spec
    assert "ecm_studio/assets/agents/skills" in spec


def test_publish_workflow_stages_and_verifies_agent_skills() -> None:
    workflow = (ROOT / ".github" / "workflows" / "publish.yml").read_text(
        encoding="utf-8"
    )

    assert "cp -R .agents/skills src/ecm_studio/assets/agents/skills" in workflow
    assert (
        "ecm_studio/assets/agents/skills/ecm-capability-manager/SKILL.md"
        in workflow
    )


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
