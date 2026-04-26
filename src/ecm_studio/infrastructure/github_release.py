from __future__ import annotations

import re
import subprocess
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from ecm_studio.domain.errors import AppError

CommandRunner = Callable[[Sequence[str], Path | None], subprocess.CompletedProcess[str]]

SCP_REMOTE_RE = re.compile(r"^(?P<user>[^@]+)@(?P<host>[^:]+):(?P<path>.+)$")


@dataclass(frozen=True)
class GitHubRemote:
    name: str
    url: str
    host: str
    owner: str
    repo: str

    @property
    def repo_arg(self) -> str:
        return f"{self.host}/{self.owner}/{self.repo}"

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "url": self.url,
            "host": self.host,
            "owner": self.owner,
            "repo": self.repo,
            "is_github": True,
        }


@dataclass(frozen=True)
class GitHubCliStatus:
    available: bool
    authenticated: bool
    message: str | None = None

    def to_dict(self) -> dict:
        return {
            "available": self.available,
            "authenticated": self.authenticated,
            "message": self.message,
        }


class GitHubReleaseService:
    def __init__(self, runner: CommandRunner | None = None) -> None:
        self.runner = runner or _run_command

    def cli_status(self, host: str) -> GitHubCliStatus:
        version = self._run(["gh", "--version"], None)
        if version is None:
            return GitHubCliStatus(False, False, "GitHub CLI is not installed or not on PATH.")
        if version.returncode != 0:
            return GitHubCliStatus(False, False, version.stderr.strip() or version.stdout.strip())

        auth = self._run(["gh", "auth", "status", "-h", host], None)
        if auth is None:
            return GitHubCliStatus(False, False, "GitHub CLI is not installed or not on PATH.")
        if auth.returncode != 0:
            return GitHubCliStatus(True, False, auth.stderr.strip() or auth.stdout.strip())
        return GitHubCliStatus(True, True, None)

    def create_release(
        self,
        repo_path: Path,
        remote: GitHubRemote,
        tag: str,
        title: str,
        notes: str,
        assets: Sequence[Path],
    ) -> str:
        status = self.cli_status(remote.host)
        if not status.available:
            raise AppError("GITHUB_CLI_MISSING", status.message or "GitHub CLI is required.")
        if not status.authenticated:
            raise AppError(
                "GITHUB_AUTH_MISSING",
                status.message or f"GitHub CLI is not authenticated for {remote.host}.",
            )

        existing_url = self._view_release(repo_path, remote, tag)
        if existing_url is not None:
            return existing_url

        args = [
            "gh",
            "release",
            "create",
            tag,
            "--repo",
            remote.repo_arg,
            "--title",
            title,
            "--notes",
            notes,
            *[str(path) for path in assets],
        ]
        result = self._run(args, repo_path)
        if result is None:
            raise AppError("GITHUB_CLI_MISSING", "GitHub CLI is required.")
        if result.returncode != 0:
            existing_url = self._view_release(repo_path, remote, tag)
            if existing_url is not None:
                return existing_url
            raise AppError(
                "GITHUB_RELEASE_FAILED",
                result.stderr.strip() or result.stdout.strip() or "GitHub Release creation failed.",
            )
        return result.stdout.strip().splitlines()[-1] if result.stdout.strip() else (
            f"https://{remote.host}/{remote.owner}/{remote.repo}/releases/tag/{tag}"
        )

    def _view_release(self, repo_path: Path, remote: GitHubRemote, tag: str) -> str | None:
        result = self._run(
            [
                "gh",
                "release",
                "view",
                tag,
                "--repo",
                remote.repo_arg,
                "--json",
                "url",
                "--jq",
                ".url",
            ],
            repo_path,
        )
        if result is None or result.returncode != 0:
            return None
        url = result.stdout.strip()
        if url:
            return url.splitlines()[-1]
        return f"https://{remote.host}/{remote.owner}/{remote.repo}/releases/tag/{tag}"

    def _run(
        self, args: Sequence[str], cwd: Path | None
    ) -> subprocess.CompletedProcess[str] | None:
        try:
            return self.runner(args, cwd)
        except FileNotFoundError:
            return None


def parse_github_remote_url(url: str, remote_name: str = "origin") -> GitHubRemote | None:
    stripped = url.strip()
    if not stripped:
        return None

    scp_match = SCP_REMOTE_RE.match(stripped)
    if scp_match:
        host = scp_match.group("host").lower()
        parts = _repo_path_parts(scp_match.group("path"))
        if parts and _is_supported_github_host(host):
            return GitHubRemote(remote_name, stripped, host, parts[0], parts[1])
        return None

    parsed = urlparse(stripped)
    host = (parsed.hostname or "").lower()
    parts = _repo_path_parts(parsed.path)
    if parts and _is_supported_github_host(host):
        return GitHubRemote(remote_name, stripped, host, parts[0], parts[1])
    return None


def _repo_path_parts(path: str) -> tuple[str, str] | None:
    normalized = path.strip().strip("/")
    if normalized.endswith(".git"):
        normalized = normalized[:-4]
    parts = [part for part in normalized.split("/") if part]
    if len(parts) < 2:
        return None
    return parts[-2], parts[-1]


def _is_supported_github_host(host: str) -> bool:
    return host == "github.com" or host == "ghe.com" or host.endswith(".ghe.com")


def _run_command(args: Sequence[str], cwd: Path | None) -> subprocess.CompletedProcess[str]:
    startupinfo = None
    creationflags = 0
    if sys.platform == "win32":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = subprocess.SW_HIDE
        creationflags = subprocess.CREATE_NO_WINDOW

    return subprocess.run(
        list(args),
        cwd=cwd,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
        startupinfo=startupinfo,
        creationflags=creationflags,
    )
