from __future__ import annotations

import shutil
import subprocess
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from ecm_studio.domain.errors import AppError, ValidationFailed

from .paths import MANAGED_PATHS


@dataclass(frozen=True)
class Checkpoint:
    id: str
    message: str
    timestamp: str
    author: str
    skipped: bool = False

    def to_dict(self) -> dict:
        return self.__dict__.copy()


class GitService:
    def __init__(self, repo_path: Path) -> None:
        self.repo_path = repo_path.resolve()

    def init(self) -> None:
        if not self.is_repo():
            self._git("init")
        self._ensure_identity()

    def is_repo(self) -> bool:
        result = self._run_git("rev-parse", "--show-toplevel", check=False)
        if result.returncode != 0:
            return False
        try:
            top_level = Path(result.stdout.strip()).resolve()
        except OSError:
            return False
        return top_level == self.repo_path

    def status(self) -> dict:
        if not self.is_repo():
            return {
                "is_repo": False,
                "clean": False,
                "changed_files": [],
                "untracked_files": [],
                "conflicted_files": [],
                "branch": None,
                "branches": [],
                "has_remote": False,
                "upstream": None,
                "ahead": 0,
                "behind": 0,
                "merge_in_progress": False,
            }
        result = self._git("status", "--porcelain=v1")
        changed: list[str] = []
        untracked: list[str] = []
        conflicted: list[str] = []
        for line in result.stdout.splitlines():
            if not line:
                continue
            code = line[:2]
            path = line[3:]
            if code == "??":
                untracked.append(path)
            elif "U" in code or code in {"AA", "DD"}:
                conflicted.append(path)
                changed.append(path)
            else:
                changed.append(path)
        return {
            "is_repo": True,
            "clean": not changed and not untracked,
            "changed_files": changed,
            "untracked_files": untracked,
            "conflicted_files": conflicted,
            "branch": self.current_branch(),
            "branches": self.list_branches(),
            "has_remote": self.has_remote(),
            "upstream": self.upstream(),
            **self.ahead_behind(),
            "merge_in_progress": self.merge_in_progress(),
        }

    def current_branch(self) -> str | None:
        result = self._run_git("branch", "--show-current", check=False)
        if result.returncode != 0:
            return None
        branch = result.stdout.strip()
        return branch or None

    def list_branches(self) -> list[str]:
        if not self.is_repo():
            return []
        result = self._run_git(
            "for-each-ref", "--format=%(refname:short)", "refs/heads", check=False
        )
        if result.returncode != 0:
            return []
        return [line.strip() for line in result.stdout.splitlines() if line.strip()]

    def has_remote(self) -> bool:
        result = self._run_git("remote", check=False)
        return result.returncode == 0 and bool(result.stdout.strip())

    def remote_url(self, remote: str = "origin") -> str | None:
        result = self._run_git("config", "--get", f"remote.{remote}.url", check=False)
        if result.returncode != 0:
            return None
        return result.stdout.strip() or None

    def upstream(self) -> str | None:
        result = self._run_git(
            "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}", check=False
        )
        if result.returncode != 0:
            return None
        return result.stdout.strip() or None

    def ahead_behind(self) -> dict[str, int]:
        if self.upstream() is None:
            return {"ahead": 0, "behind": 0}
        result = self._run_git("rev-list", "--left-right", "--count", "HEAD...@{u}", check=False)
        if result.returncode != 0:
            return {"ahead": 0, "behind": 0}
        parts = result.stdout.split()
        if len(parts) != 2:
            return {"ahead": 0, "behind": 0}
        return {"ahead": int(parts[0]), "behind": int(parts[1])}

    def merge_in_progress(self) -> bool:
        git_dir = self._git_dir()
        return git_dir is not None and (git_dir / "MERGE_HEAD").exists()

    def checkpoint(self, message: str, paths: Iterable[str] | None = None) -> Checkpoint:
        self.init()
        add_paths = list(paths or MANAGED_PATHS)
        self._git("add", "--", *add_paths)
        staged = self._git("diff", "--cached", "--name-only").stdout.strip()
        if not staged:
            latest = self._latest_checkpoint()
            if latest is not None:
                data = latest.to_dict()
                data["skipped"] = True
                return Checkpoint(**data)
            return Checkpoint(
                id="", message="No changes to checkpoint", timestamp="", author="", skipped=True
            )
        self._git("commit", "-m", message.strip() or "ECM checkpoint")
        latest = self._latest_checkpoint()
        if latest is None:
            raise AppError("GIT_FAILED", "Checkpoint was created but could not be read.")
        return latest

    def history(self, limit: int = 50) -> list[Checkpoint]:
        if not self.is_repo():
            return []
        fmt = "%H%x1f%an%x1f%aI%x1f%s"
        result = self._run_git("log", f"--max-count={limit}", f"--pretty=format:{fmt}", check=False)
        if result.returncode != 0 or not result.stdout.strip():
            return []
        checkpoints: list[Checkpoint] = []
        for line in result.stdout.splitlines():
            parts = line.split("\x1f", 3)
            if len(parts) == 4:
                checkpoints.append(
                    Checkpoint(id=parts[0], author=parts[1], timestamp=parts[2], message=parts[3])
                )
        return checkpoints

    def graph(self, limit: int = 50) -> dict:
        normalized_limit = max(1, min(limit, 500))
        if not self.is_repo():
            return {
                "commits": [],
                "current_branch": None,
                "limit": normalized_limit,
                "truncated": False,
            }

        result = self._run_git(
            "log",
            "--all",
            f"--max-count={normalized_limit + 1}",
            "--pretty=format:%H%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%b%x00",
            check=False,
        )
        if result.returncode != 0 or not result.stdout.strip("\x00\r\n"):
            return {
                "commits": [],
                "current_branch": self.current_branch(),
                "limit": normalized_limit,
                "truncated": False,
            }

        parsed_commits = self._parse_graph_log(result.stdout)
        clipped = len(parsed_commits) > normalized_limit
        visible_commits = parsed_commits[:normalized_limit]
        visible_hashes = {commit["hash"] for commit in visible_commits}
        refs_by_commit = self._local_refs_by_commit()
        truncated = clipped

        commits = []
        for commit in visible_commits:
            visible_parents = [parent for parent in commit["parents"] if parent in visible_hashes]
            if len(visible_parents) != len(commit["parents"]):
                truncated = True
            commits.append(
                {
                    **commit,
                    "parents": visible_parents,
                    "refs": refs_by_commit.get(commit["hash"], []),
                }
            )

        return {
            "commits": commits,
            "current_branch": self.current_branch(),
            "limit": normalized_limit,
            "truncated": truncated,
        }

    def compare(self, from_ref: str, to_ref: str) -> dict:
        self._require_repo()
        summary = self._git("diff", "--numstat", from_ref, to_ref).stdout
        files: list[dict] = []
        for line in summary.splitlines():
            parts = line.split("\t")
            if len(parts) >= 3:
                additions = 0 if parts[0] == "-" else int(parts[0])
                deletions = 0 if parts[1] == "-" else int(parts[1])
                files.append({"path": parts[2], "additions": additions, "deletions": deletions})
        return {"from": from_ref, "to": to_ref, "files": files}

    def integration_candidates(self) -> list[dict]:
        self._require_repo()
        current = self.current_branch()
        if current is None:
            return []
        candidates: list[dict] = []
        for branch in self.list_branches():
            if branch == current:
                continue
            candidates.append(
                {
                    "name": branch,
                    "integrable": not self.is_ancestor(branch, "HEAD"),
                }
            )
        return candidates

    def restore(self, checkpoint_id: str, force: bool = False) -> None:
        self._require_repo()
        status = self.status()
        if not force and not status["clean"]:
            raise AppError(
                "GIT_WORKTREE_DIRTY",
                "Working tree has uncommitted changes. Create a checkpoint before restoring.",
        )
        self._git("checkout", checkpoint_id, "--", "ecm-studio.json", "ecm")

    def discard_pending_changes(self) -> dict[str, list[str]]:
        self._require_repo()
        status = self.status()
        if status["merge_in_progress"] or status["conflicted_files"]:
            raise AppError(
                "GIT_DISCARD_BLOCKED",
                "Resolve or abort the current integration before discarding pending changes.",
            )

        changed_files = list(dict.fromkeys(status["changed_files"]))
        untracked_files = list(dict.fromkeys(status["untracked_files"]))

        if changed_files:
            self._git("restore", "--staged", "--worktree", "--", *changed_files)

        deleted_files: list[str] = []
        for relative_path in untracked_files:
            target = (self.repo_path / relative_path).resolve()
            try:
                target.relative_to(self.repo_path)
            except ValueError as exc:
                raise AppError(
                    "GIT_DISCARD_FAILED",
                    "Refusing to delete a pending file outside the workspace.",
                    {"path": relative_path},
                ) from exc
            if not target.exists():
                continue
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()
            deleted_files.append(relative_path)

        return {"reverted_files": changed_files, "deleted_files": deleted_files}

    def create_branch(self, name: str, switch: bool = True) -> dict:
        self._require_repo()
        branch = self._validated_branch_name(name)
        if branch in self.list_branches():
            raise AppError("GIT_BRANCH_EXISTS", f'Branch "{branch}" already exists.')
        self._require_clean()
        previous = self.current_branch()
        self._git("switch", "-c", branch)
        if not switch and previous and previous != branch:
            self._git("switch", previous)
        return {"branch": branch, "current_branch": self.current_branch()}

    def switch_branch(self, name: str) -> dict:
        self._require_repo()
        branch = self._validated_branch_name(name)
        if branch not in self.list_branches():
            raise AppError("GIT_BRANCH_NOT_FOUND", f'Branch "{branch}" does not exist.')
        self._require_clean()
        self._git("switch", branch)
        return {"branch": branch}

    def merge_branch(self, source_branch: str) -> dict:
        self._require_repo()
        branch = self._validated_branch_name(source_branch)
        if branch not in self.list_branches():
            raise AppError("GIT_BRANCH_NOT_FOUND", f'Branch "{branch}" does not exist.')
        self._require_clean()
        if self.is_ancestor(branch, "HEAD"):
            raise AppError(
                "GIT_BRANCH_ALREADY_INTEGRATED",
                f'Scenario "{branch}" is already integrated into the current scenario.',
            )
        result = self._run_git("merge", "--no-ff", branch, "-m", f"Merge {branch}", check=False)
        if result.returncode != 0:
            status = self.status()
            if status.get("conflicted_files") or status.get("merge_in_progress"):
                raise AppError(
                    "GIT_CONFLICT",
                    "Merge produced conflicts. Resolve externally or abort the merge.",
                    status,
                )
            raise AppError("GIT_FAILED", result.stderr.strip() or result.stdout.strip())
        return {"merged": True, "source_branch": branch, "target_branch": self.current_branch()}

    def abort_merge(self) -> dict:
        self._require_repo()
        if not self.merge_in_progress():
            return {"aborted": False, "merge_in_progress": False}
        self._git("merge", "--abort")
        return {"aborted": True, "merge_in_progress": False}

    def tag_release(self, tag: str, message: str | None = None) -> None:
        self._require_repo()
        if not tag.strip():
            raise ValidationFailed("Tag name is required.")
        args = ["tag", "-a", tag.strip(), "-m", message or tag.strip()]
        self._git(*args)

    def tag_exists(self, tag: str) -> bool:
        self._require_repo()
        if not tag.strip():
            return False
        result = self._run_git(
            "rev-parse",
            "-q",
            "--verify",
            f"refs/tags/{tag.strip()}",
            check=False,
        )
        return result.returncode == 0

    def is_ancestor(self, ancestor_ref: str, descendant_ref: str = "HEAD") -> bool:
        self._require_repo()
        result = self._run_git(
            "merge-base",
            "--is-ancestor",
            f"{ancestor_ref}^{{commit}}",
            descendant_ref,
            check=False,
        )
        return result.returncode == 0

    def pull(self, remote: str = "origin", branch: str | None = None) -> dict:
        self._require_repo()
        if not self.has_remote():
            raise AppError("GIT_REMOTE_MISSING", "This workspace has no configured Git remote.")
        self._require_clean()
        target_branch = branch or self.current_branch() or "main"
        result = self._git("pull", "--ff-only", remote, target_branch)
        return {"pulled": True, "remote": remote, "branch": target_branch, "summary": result.stdout}

    def push(self, remote: str = "origin", branch: str | None = None) -> dict:
        self._require_repo()
        if not self.has_remote():
            raise AppError("GIT_REMOTE_MISSING", "This workspace has no configured Git remote.")
        target_branch = branch or self.current_branch() or "main"
        self._git("push", "-u", remote, target_branch)
        return {"pushed": True, "remote": remote, "branch": target_branch}

    def push_tag(self, tag: str, remote: str = "origin") -> dict:
        self._require_repo()
        if not self.has_remote():
            raise AppError("GIT_REMOTE_MISSING", "This workspace has no configured Git remote.")
        if not self.tag_exists(tag):
            raise AppError("RELEASE_TAG_MISSING", f'Release tag "{tag}" does not exist.')
        self._git("push", remote, tag)
        return {"pushed": True, "remote": remote, "tag": tag}

    def _latest_checkpoint(self) -> Checkpoint | None:
        history = self.history(1)
        return history[0] if history else None

    def _parse_graph_log(self, output: str) -> list[dict]:
        fields = output.split("\x00")
        if fields and fields[-1] == "":
            fields.pop()

        commits: list[dict] = []
        field_count = 7
        for index in range(0, len(fields), field_count):
            chunk = fields[index : index + field_count]
            if len(chunk) != field_count:
                continue
            commit_hash, parents, author_name, author_email, timestamp, subject, body = chunk
            commit_hash = commit_hash.strip()
            if not commit_hash:
                continue
            commits.append(
                {
                    "hash": commit_hash,
                    "parents": [parent for parent in parents.split() if parent],
                    "subject": subject,
                    "body": body.strip(),
                    "author": {
                        "name": author_name,
                        "email": author_email,
                        "timestamp": _safe_int(timestamp),
                    },
                }
            )
        return commits

    def _local_refs_by_commit(self) -> dict[str, list[str]]:
        result = self._run_git(
            "for-each-ref",
            "--format=%(objectname)%00%(*objectname)%00%(refname:short)%00%(refname)%00",
            "refs/heads",
            "refs/tags",
            check=False,
        )
        if result.returncode != 0:
            return {}

        refs_by_commit: dict[str, list[str]] = {}
        fields = result.stdout.split("\x00")
        if fields and fields[-1] == "":
            fields.pop()
        for index in range(0, len(fields), 4):
            chunk = fields[index : index + 4]
            if len(chunk) != 4:
                continue
            object_hash, peeled_hash, short_name, full_name = chunk
            object_hash = object_hash.strip()
            peeled_hash = peeled_hash.strip()
            short_name = short_name.strip()
            full_name = full_name.strip()
            commit_hash = peeled_hash or object_hash
            if not commit_hash or not short_name:
                continue
            ref_name = f"tag: {short_name}" if full_name.startswith("refs/tags/") else short_name
            refs_by_commit.setdefault(commit_hash, []).append(ref_name)
        for refs in refs_by_commit.values():
            refs.sort(key=lambda ref: (ref.startswith("tag: "), ref))
        return refs_by_commit

    def _require_repo(self) -> None:
        if not self.is_repo():
            raise AppError("GIT_NOT_INITIALIZED", "Workspace is not a Git repository.")

    def _require_clean(self) -> None:
        status = self.status()
        if not status["clean"]:
            raise AppError(
                "GIT_WORKTREE_DIRTY",
                "Working tree is not clean. Create a checkpoint before this Git operation.",
                status,
            )

    def _validated_branch_name(self, name: str) -> str:
        branch = name.strip()
        if not branch:
            raise ValidationFailed("Branch name is required.")
        result = self._run_git("check-ref-format", "--branch", branch, check=False)
        if result.returncode != 0:
            raise ValidationFailed(f'Branch name "{branch}" is not valid.')
        return branch

    def _git_dir(self) -> Path | None:
        result = self._run_git("rev-parse", "--git-dir", check=False)
        if result.returncode != 0 or not result.stdout.strip():
            return None
        path = Path(result.stdout.strip())
        if not path.is_absolute():
            path = self.repo_path / path
        return path.resolve()

    def _ensure_identity(self) -> None:
        name = self._run_git("config", "user.name", check=False)
        if name.returncode != 0 or not name.stdout.strip():
            self._git("config", "user.name", "ECM Studio")
        email = self._run_git("config", "user.email", check=False)
        if email.returncode != 0 or not email.stdout.strip():
            self._git("config", "user.email", "ecm-studio@example.local")

    def _git(self, *args: str) -> subprocess.CompletedProcess[str]:
        return self._run_git(*args, check=True)

    def _run_git(self, *args: str, check: bool) -> subprocess.CompletedProcess[str]:
        startupinfo = None
        creationflags = 0
        if sys.platform == "win32":
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = subprocess.SW_HIDE
            creationflags = subprocess.CREATE_NO_WINDOW

        result = subprocess.run(
            ["git", *args],
            cwd=self.repo_path,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            check=False,
            startupinfo=startupinfo,
            creationflags=creationflags,
        )
        if check and result.returncode != 0:
            raise AppError(
                "GIT_FAILED", result.stderr.strip() or result.stdout.strip(), {"args": args}
            )
        return result


def _safe_int(value: str) -> int:
    try:
        return int(value)
    except ValueError:
        return 0
