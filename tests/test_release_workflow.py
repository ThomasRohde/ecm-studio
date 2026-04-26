from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

import pytest

from ecm_studio.application.services import AppServices, ReleaseAppService
from ecm_studio.domain.errors import AppError
from ecm_studio.infrastructure.git_service import GitService
from ecm_studio.infrastructure.github_release import (
    GitHubCliStatus,
    GitHubReleaseService,
    GitHubRemote,
    parse_github_remote_url,
)
from ecm_studio.infrastructure.jsonl import read_raw_jsonl, write_jsonl


class FakeGitHub:
    def __init__(self, status: GitHubCliStatus | None = None) -> None:
        self.status = status or GitHubCliStatus(True, True)
        self.calls: list[dict[str, Any]] = []

    def cli_status(self, host: str) -> GitHubCliStatus:
        self.calls.append({"method": "cli_status", "host": host})
        return self.status

    def create_release(
        self,
        repo_path: Path,
        remote: Any,
        tag: str,
        title: str,
        notes: str,
        assets: list[Path],
    ) -> str:
        self.calls.append(
            {
                "method": "create_release",
                "repo_path": repo_path,
                "repo": remote.repo_arg,
                "tag": tag,
                "title": title,
                "notes": notes,
                "assets": assets,
            }
        )
        return f"https://{remote.host}/{remote.owner}/{remote.repo}/releases/tag/{tag}"


def test_parse_github_and_ghe_remote_urls() -> None:
    github = parse_github_remote_url("https://github.com/acme/ecm-studio.git")
    ghe = parse_github_remote_url("git@bank.ghe.com:architecture/ecm-studio.git")
    unsupported = parse_github_remote_url("https://example.com/acme/ecm-studio.git")

    assert github is not None
    assert github.host == "github.com"
    assert github.owner == "acme"
    assert github.repo == "ecm-studio"
    assert ghe is not None
    assert ghe.host == "bank.ghe.com"
    assert ghe.repo_arg == "bank.ghe.com/architecture/ecm-studio"
    assert unsupported is None


def test_cut_release_requires_github_remote(tmp_path: Path) -> None:
    services = AppServices(settings_path=tmp_path / "settings.json")
    services.workspace.init(str(tmp_path / "workspace"), "Release")
    services.capabilities.create({"name": "Payments"})

    with pytest.raises(AppError) as exc:
        services.releases.cut("1.2.3")

    assert exc.value.code == "RELEASE_REMOTE_MISSING"


def test_cut_release_writes_metadata_exports_checkpoint_and_tag(tmp_path: Path) -> None:
    services, git, _ = _release_workspace(tmp_path)

    result = services.releases.cut("1.2.3", "Release notes")

    assert result["tag"] == "ecm-v1.2.3"
    assert result["checkpoint_id"]
    assert git.tag_exists("ecm-v1.2.3") is True
    records = read_raw_jsonl(tmp_path / "workspace" / "ecm" / "model_versions.jsonl").records
    release = records[-1]
    assert release["action"] == "release"
    assert release["version_label"] == "1.2.3"
    assert release["tag"] == "ecm-v1.2.3"
    assert len(release["export_paths"]) == 3
    for export_path in release["export_paths"]:
        assert (tmp_path / "workspace" / export_path).exists()
    assert git.history(1)[0].message == "Release ecm-v1.2.3"


def test_cut_release_blocks_dirty_incoming_invalid_and_duplicate(tmp_path: Path) -> None:
    services, git, _ = _release_workspace(tmp_path)

    with pytest.raises(AppError) as exc:
        services.releases.cut("1.2")
    assert exc.value.code == "RELEASE_INVALID_VERSION"

    (tmp_path / "workspace" / "ecm" / "capabilities.jsonl").write_text("dirty\n", encoding="utf-8")
    with pytest.raises(AppError) as exc:
        services.releases.cut("1.2.3")
    assert exc.value.code == "RELEASE_WORKTREE_DIRTY"

    git.restore(git.history()[-1].id, force=True)
    git.checkpoint("Restore clean model")
    git.push()

    services.releases.cut("1.2.3")
    with pytest.raises(AppError) as exc:
        services.releases.cut("1.2.3")
    assert exc.value.code == "RELEASE_TAG_EXISTS"

    _advance_remote(tmp_path)
    git._run_git("fetch", "origin", check=True)
    with pytest.raises(AppError) as exc:
        services.releases.cut("1.2.4")
    assert exc.value.code == "RELEASE_INCOMING_CHANGES"


def test_cut_release_blocks_detached_head(tmp_path: Path) -> None:
    services, git, _ = _release_workspace(tmp_path)
    git._run_git("checkout", git.history(1)[0].id, check=True)

    with pytest.raises(AppError) as exc:
        services.releases.cut("1.2.3")

    assert exc.value.code == "RELEASE_DETACHED_HEAD"


def test_publish_release_pushes_tag_creates_github_release_and_records_event(
    tmp_path: Path,
) -> None:
    services, git, fake_github = _release_workspace(
        tmp_path,
        github_url="https://ghe.com/acme/ecm.git",
    )
    release = services.releases.cut("2.0.0")

    result = services.releases.publish(release["tag"])

    assert result["github_release_url"] == "https://ghe.com/acme/ecm/releases/tag/ecm-v2.0.0"
    assert result["checkpoint_id"]
    create_calls = [call for call in fake_github.calls if call["method"] == "create_release"]
    assert create_calls
    assert create_calls[0]["repo"] == "ghe.com/acme/ecm"
    assert [path.name for path in create_calls[0]["assets"]] == [
        "capabilities.jsonl",
        "capabilities.csv",
        "capabilities.bundle.json",
    ]
    events = read_raw_jsonl(tmp_path / "workspace" / "ecm" / "publish_events.jsonl").records
    assert events[-1]["tag"] == "ecm-v2.0.0"
    assert events[-1]["delivery_status"] == "success"
    assert git.status()["ahead"] == 0


def test_publish_release_rejects_assets_outside_release_export_dir(tmp_path: Path) -> None:
    services, git, _ = _release_workspace(tmp_path)
    release = services.releases.cut("2.1.0")
    workspace_root = tmp_path / "workspace"
    (tmp_path / "secret.txt").write_text("do not publish\n", encoding="utf-8")
    model_versions = workspace_root / "ecm" / "model_versions.jsonl"
    records = read_raw_jsonl(model_versions).records
    records[-1]["export_paths"] = ["../../secret.txt"]
    write_jsonl(model_versions, records)
    git.checkpoint("Malicious release metadata")

    with pytest.raises(AppError) as exc:
        services.releases.publish(release["tag"])

    assert exc.value.code == "GITHUB_RELEASE_FAILED"
    assert "outside the release export directory" in exc.value.message


def test_publish_release_blocks_missing_gh_and_missing_tag(tmp_path: Path) -> None:
    services, _, _ = _release_workspace(
        tmp_path,
        github=FakeGitHub(GitHubCliStatus(False, False, "missing gh")),
    )
    services.releases.cut("3.0.0")

    with pytest.raises(AppError) as exc:
        services.releases.publish("ecm-v3.0.0")
    assert exc.value.code == "GITHUB_CLI_MISSING"

    missing_tag_root = tmp_path / "missing-tag"
    missing_tag_root.mkdir()
    services, _, _ = _release_workspace(missing_tag_root)
    with pytest.raises(AppError) as exc:
        services.releases.publish("ecm-v9.9.9")
    assert exc.value.code == "RELEASE_TAG_MISSING"


def test_github_release_service_reuses_existing_release(tmp_path: Path) -> None:
    calls: list[list[str]] = []

    def runner(
        args: list[str] | tuple[str, ...],
        cwd: Path | None,
    ) -> subprocess.CompletedProcess[str]:
        _ = cwd
        calls.append(list(args))
        if args[:2] == ["gh", "--version"]:
            return subprocess.CompletedProcess(args, 0, stdout="gh version\n", stderr="")
        if args[:3] == ["gh", "auth", "status"]:
            return subprocess.CompletedProcess(args, 0, stdout="", stderr="")
        if args[:3] == ["gh", "release", "view"]:
            return subprocess.CompletedProcess(
                args,
                0,
                stdout="https://ghe.com/acme/ecm/releases/tag/ecm-v1.0.0\n",
                stderr="",
            )
        return subprocess.CompletedProcess(args, 1, stdout="", stderr="unexpected create")

    service = GitHubReleaseService(runner)
    url = service.create_release(
        tmp_path,
        GitHubRemote("origin", "https://ghe.com/acme/ecm.git", "ghe.com", "acme", "ecm"),
        "ecm-v1.0.0",
        "ECM ecm-v1.0.0",
        "notes",
        [],
    )

    assert url == "https://ghe.com/acme/ecm/releases/tag/ecm-v1.0.0"
    assert ["gh", "release", "create"] not in [call[:3] for call in calls]


def _release_workspace(
    tmp_path: Path,
    github_url: str = "https://github.com/acme/ecm.git",
    github: FakeGitHub | None = None,
) -> tuple[AppServices, GitService, FakeGitHub]:
    workspace_root = tmp_path / "workspace"
    services = AppServices(settings_path=tmp_path / "settings.json")
    services.workspace.init(str(workspace_root), "Release")
    services.capabilities.create({"name": "Payments"})
    git = GitService(workspace_root)
    git.checkpoint("Initial model")
    remote = tmp_path / "remote.git"
    git._run_git("init", "--bare", str(remote), check=True)
    git._run_git("remote", "add", "origin", github_url, check=True)
    git._run_git("config", f"url.{remote.resolve().as_uri()}.insteadOf", github_url, check=True)
    git.push()
    fake = github or FakeGitHub()
    services.releases = ReleaseAppService(services.context, fake)
    return services, git, fake


def _advance_remote(tmp_path: Path) -> None:
    remote = tmp_path / "remote.git"
    clone = tmp_path / "external"
    subprocess.run(["git", "clone", str(remote), str(clone)], check=True, capture_output=True)
    subprocess.run(["git", "config", "user.name", "External"], cwd=clone, check=True)
    subprocess.run(["git", "config", "user.email", "external@example.local"], cwd=clone, check=True)
    (clone / "external.txt").write_text("remote change\n", encoding="utf-8")
    subprocess.run(["git", "add", "external.txt"], cwd=clone, check=True)
    subprocess.run(["git", "commit", "-m", "Remote change"], cwd=clone, check=True)
    subprocess.run(["git", "push"], cwd=clone, check=True)
