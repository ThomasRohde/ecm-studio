from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / ".agents" / "skills" / "ecm-capability-manager" / "scripts" / "ecm_repo.py"
FIXTURES = ROOT / ".agents" / "skills" / "ecm-capability-manager" / "fixtures"


def run_helper(workspace: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(HELPER), "--workspace", str(workspace), *args],
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )


def copy_workspace(tmp_path: Path, fixture_name: str) -> Path:
    target = tmp_path / fixture_name
    shutil.copytree(FIXTURES / fixture_name, target)
    return target


def payload(result: subprocess.CompletedProcess[str]) -> dict:
    assert result.stderr == ""
    return json.loads(result.stdout)


def test_import_map_writes_artifact_without_touching_model(tmp_path: Path) -> None:
    workspace = copy_workspace(tmp_path, "valid-workspace")
    capabilities_file = workspace / "ecm" / "capabilities.jsonl"
    before = capabilities_file.read_text(encoding="utf-8")
    output = tmp_path / "mapped.jsonl"

    result = run_helper(
        workspace,
        "import-map",
        "--source",
        str(FIXTURES / "import" / "source.csv"),
        "--mapping",
        str(FIXTURES / "import" / "mapping.json"),
        "--output",
        str(output),
        "--format",
        "jsonl",
    )

    data = payload(result)
    assert result.returncode == 0
    assert data["ok"] is True
    assert data["count"] == 2
    assert output.exists()
    assert capabilities_file.read_text(encoding="utf-8") == before


def test_reports_surface_quality_impact_and_governance(tmp_path: Path) -> None:
    workspace = copy_workspace(tmp_path, "valid-workspace")

    quality = payload(run_helper(workspace, "quality-report"))
    impact = payload(run_helper(workspace, "impact", "--id", "cap-payments"))

    assert quality["ok"] is True
    assert quality["report"]["capability_count"] == 3
    assert any(item["file"].endswith("downstream_consumers.jsonl") for item in impact["references"])

    governance_workspace = copy_workspace(tmp_path, "governance-gaps-workspace")
    governance = payload(run_helper(governance_workspace, "governance-audit"))

    assert governance["ok"] is True
    assert {item["code"] for item in governance["findings"]} >= {
        "MISSING_STEWARD",
        "STRUCTURAL_EVENT_WITHOUT_RATIONALE",
    }


def test_invalid_model_and_bulk_plan_errors_are_nonzero(tmp_path: Path) -> None:
    duplicate_workspace = copy_workspace(tmp_path, "duplicate-name-workspace")
    invalid = run_helper(duplicate_workspace, "validate")

    assert invalid.returncode == 1
    assert "DUPLICATE_NAME" in invalid.stdout

    workspace = copy_workspace(tmp_path, "valid-workspace")
    changes = tmp_path / "changes.json"
    changes.write_text(
        json.dumps({"operations": [{"action": "create", "name": "No ID"}]}),
        encoding="utf-8",
    )

    planned = payload(run_helper(workspace, "bulk-plan", "--changes", str(changes)))

    assert planned["ok"] is False
    assert planned["errors"][0]["message"] == "Bulk create requires an explicit id."


def test_bulk_plan_outputs_executable_commands(tmp_path: Path) -> None:
    workspace = copy_workspace(tmp_path, "valid-workspace")
    changes = tmp_path / "changes.json"
    changes.write_text(
        json.dumps(
            {
                "operations": [
                    {
                        "action": "update",
                        "id": "cap-payments",
                        "name": "Payment Services",
                        "tags": ["payments", "services"],
                    },
                    {
                        "action": "move",
                        "id": "cap-onboarding",
                        "parent_id": None,
                        "order": 0,
                    },
                ]
            }
        ),
        encoding="utf-8",
    )

    planned = payload(run_helper(workspace, "bulk-plan", "--changes", str(changes)))

    assert planned["ok"] is True
    assert planned["plan"][0]["command"][-5:] == [
        "--name",
        "Payment Services",
        "--tag",
        "payments",
        "--tag",
        "services",
    ][-5:]
    assert "--order" in planned["plan"][1]["command"]


def test_release_readiness_and_diff_use_git_refs(tmp_path: Path) -> None:
    workspace = copy_workspace(tmp_path, "valid-workspace")
    _git(workspace, "init")
    _git(workspace, "config", "user.name", "Test")
    _git(workspace, "config", "user.email", "test@example.local")
    _git(workspace, "add", ".")
    _git(workspace, "commit", "-m", "Base model")
    base = _git(workspace, "rev-parse", "HEAD").stdout.strip()

    update = run_helper(workspace, "update", "--id", "cap-payments", "--name", "Payment Services")
    assert update.returncode == 0
    _git(workspace, "add", ".")
    _git(workspace, "commit", "-m", "Rename payments")

    readiness = payload(run_helper(workspace, "release-readiness", "--version", "1.2.3"))
    diff = payload(run_helper(workspace, "diff", "--from", base, "--to", "HEAD"))

    assert readiness["ok"] is False
    assert any(item["code"] == "RELEASE_REMOTE_MISSING" for item in readiness["blockers"])
    assert diff["ok"] is True
    assert diff["summary"]["renamed"] == 1


def _git(cwd: Path, *args: str) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["git", *args],
        cwd=cwd,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr or result.stdout
    return result
