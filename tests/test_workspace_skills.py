from __future__ import annotations

import shutil
from pathlib import Path

from ecm_studio.infrastructure.git_service import GitService
from ecm_studio.infrastructure.workspace import WorkspaceRepository


def test_workspace_init_installs_bundled_agent_skills(tmp_path: Path) -> None:
    workspace = WorkspaceRepository(tmp_path)

    workspace.init("Skills")

    skills = tmp_path / ".agents" / "skills"
    manager = skills / "ecm-capability-manager"
    assert (manager / "SKILL.md").exists()
    assert (manager / "scripts" / "ecm_repo.py").exists()
    assert (manager / "references" / "repo-contract.md").exists()
    assert (skills / "ecm-model-validator" / "SKILL.md").exists()
    assert not (tmp_path / ".agents" / "copilot-instructions.md").exists()
    assert not (tmp_path / ".agents" / "workflows").exists()


def test_workspace_init_preserves_existing_agent_skill_files(tmp_path: Path) -> None:
    existing = tmp_path / ".agents" / "skills" / "ecm-capability-manager" / "SKILL.md"
    existing.parent.mkdir(parents=True)
    existing.write_text("custom skill\n", encoding="utf-8")
    workspace = WorkspaceRepository(tmp_path)

    workspace.init("Preserve Skills")

    assert existing.read_text(encoding="utf-8") == "custom skill\n"
    assert (existing.parent / "scripts" / "ecm_repo.py").exists()


def test_git_checkpoint_includes_installed_agent_skills(tmp_path: Path) -> None:
    workspace = WorkspaceRepository(tmp_path)
    workspace.init("Checkpoint Skills")
    git = GitService(tmp_path)
    git.init()

    checkpoint = git.checkpoint("Initial")

    committed = _committed_paths(git, checkpoint.id)
    assert ".agents/skills/ecm-capability-manager/SKILL.md" in committed
    assert ".agents/skills/ecm-capability-manager/scripts/ecm_repo.py" in committed


def test_git_checkpoint_skips_missing_agent_skills_for_older_workspace(
    tmp_path: Path,
) -> None:
    workspace = WorkspaceRepository(tmp_path)
    workspace.init("Older Workspace")
    shutil.rmtree(tmp_path / ".agents")
    git = GitService(tmp_path)
    git.init()

    checkpoint = git.checkpoint("Initial older workspace")

    assert checkpoint.id
    assert all(not path.startswith(".agents/") for path in _committed_paths(git, checkpoint.id))


def _committed_paths(git: GitService, commit: str) -> set[str]:
    result = git._run_git("show", "--pretty=format:", "--name-only", commit, check=True)
    return {line.replace("\\", "/") for line in result.stdout.splitlines() if line.strip()}
