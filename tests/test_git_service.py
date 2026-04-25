from __future__ import annotations

from pathlib import Path

import pytest

from ecm_workbench.domain.errors import AppError
from ecm_workbench.infrastructure.git_service import GitService
from ecm_workbench.infrastructure.workspace import WorkspaceRepository


def test_git_checkpoint_history_compare_and_restore(tmp_path: Path) -> None:
    workspace = WorkspaceRepository(tmp_path)
    workspace.init("Git Test")
    git = GitService(tmp_path)
    git.init()

    first = git.checkpoint("Initial ECM workspace")
    assert first.id

    capabilities = tmp_path / "ecm" / "capabilities.jsonl"
    capabilities.write_text(
        '{"_t":"capability","schema_version":"1.0","id":"1","name":"A"}\n', encoding="utf-8"
    )
    second = git.checkpoint("Add capability")

    history = git.history()
    assert history[0].id == second.id
    assert len(history) >= 2
    diff = git.compare(first.id, second.id)
    assert any(
        file["path"].replace("\\", "/") == "ecm/capabilities.jsonl" for file in diff["files"]
    )

    capabilities.write_text("broken\n", encoding="utf-8")
    git.restore(first.id, force=True)
    assert capabilities.read_text(encoding="utf-8") == ""


def test_git_service_initializes_nested_workspace_inside_parent_repo(tmp_path: Path) -> None:
    parent = tmp_path / "parent"
    parent.mkdir()
    GitService(parent).init()
    (parent / ".gitignore").write_text("ignored/\n", encoding="utf-8")

    nested = parent / "ignored" / "workspace"
    workspace = WorkspaceRepository(nested)
    workspace.init("Nested")
    nested_git = GitService(nested)
    nested_git.init()

    checkpoint = nested_git.checkpoint("Nested setup")

    assert (nested / ".git").exists()
    assert checkpoint.id


def test_git_branch_switch_and_dirty_guardrails(tmp_path: Path) -> None:
    workspace = WorkspaceRepository(tmp_path)
    workspace.init("Branching")
    git = GitService(tmp_path)
    git.init()
    git.checkpoint("Initial")
    base_branch = git.current_branch()

    created = git.create_branch("work/test")
    git.switch_branch(base_branch or "master")

    assert created["branch"] == "work/test"
    assert "work/test" in git.list_branches()

    (tmp_path / "ecm" / "capabilities.jsonl").write_text("dirty\n", encoding="utf-8")
    with pytest.raises(AppError) as exc:
        git.create_branch("work/blocked")
    assert exc.value.code == "GIT_WORKTREE_DIRTY"


def test_git_merge_conflict_detection_and_abort(tmp_path: Path) -> None:
    workspace = WorkspaceRepository(tmp_path)
    workspace.init("Conflict")
    capabilities = tmp_path / "ecm" / "capabilities.jsonl"
    capabilities.write_text("base\n", encoding="utf-8")
    git = GitService(tmp_path)
    git.init()
    git.checkpoint("Initial")
    base_branch = git.current_branch() or "master"

    git.create_branch("work/conflict")
    capabilities.write_text("feature\n", encoding="utf-8")
    git.checkpoint("Feature change")

    git.switch_branch(base_branch)
    capabilities.write_text("base change\n", encoding="utf-8")
    git.checkpoint("Base change")

    with pytest.raises(AppError) as exc:
        git.merge_branch("work/conflict")
    assert exc.value.code == "GIT_CONFLICT"
    assert git.status()["merge_in_progress"] is True

    aborted = git.abort_merge()

    assert aborted["aborted"] is True
    assert git.status()["merge_in_progress"] is False


def test_git_push_requires_remote_and_pushes_when_configured(tmp_path: Path) -> None:
    workspace = WorkspaceRepository(tmp_path / "workspace")
    workspace.init("Remote")
    git = GitService(workspace.root)
    git.init()
    git.checkpoint("Initial")

    with pytest.raises(AppError) as exc:
        git.push()
    assert exc.value.code == "GIT_REMOTE_MISSING"

    remote = tmp_path / "remote.git"
    GitService(workspace.root)._run_git("init", "--bare", str(remote), check=True)
    GitService(workspace.root)._run_git("remote", "add", "origin", str(remote), check=True)

    result = git.push()

    assert result["pushed"] is True
    assert git.status()["has_remote"] is True
