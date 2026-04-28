from __future__ import annotations

import json
import shutil
from pathlib import Path

from ecm_studio.domain.errors import ValidationFailed
from ecm_studio.domain.models import WorkspaceConfig

from .jsonl import atomic_write_text
from .paths import (
    AGENT_SKILLS_DIR,
    CONFIG_FILE,
    ECM_DIR,
    EXPORTS_DIR,
    JSONL_FILES,
    LOGS_DIR,
    WorkspacePaths,
)

WORKSPACE_GITIGNORE = """\
# ECM Studio local runtime state
.ecm-studio/
*.sqlite
*.sqlite-shm
*.sqlite-wal
"""


class WorkspaceRepository:
    def __init__(self, root: Path) -> None:
        self.paths = WorkspacePaths(root.resolve())

    @property
    def root(self) -> Path:
        return self.paths.root

    def exists(self) -> bool:
        return self.paths.config_file.exists() and self.paths.ecm_dir.exists()

    def require_exists(self) -> None:
        if not self.exists():
            raise ValidationFailed(f'"{self.root}" is not an ECM workspace.')

    def init(self, name: str) -> WorkspaceConfig:
        self.root.mkdir(parents=True, exist_ok=True)
        self.paths.cache_dir.mkdir(parents=True, exist_ok=True)
        (self.root / LOGS_DIR).mkdir(parents=True, exist_ok=True)
        (self.root / ECM_DIR).mkdir(parents=True, exist_ok=True)
        (self.root / EXPORTS_DIR).mkdir(parents=True, exist_ok=True)
        for relative in JSONL_FILES:
            file_path = self.root / relative
            file_path.parent.mkdir(parents=True, exist_ok=True)
            if not file_path.exists():
                file_path.write_text("", encoding="utf-8", newline="\n")
        gitignore = self.root / ".gitignore"
        existing = gitignore.read_text(encoding="utf-8") if gitignore.exists() else ""
        if ".ecm-studio/" not in existing:
            atomic_write_text(
                gitignore, (existing.rstrip() + "\n\n" + WORKSPACE_GITIGNORE).lstrip()
            )
        self._install_bundled_skills()
        config = WorkspaceConfig(name=name.strip() or self.root.name)
        self.write_config(config)
        return config

    def load_config(self) -> WorkspaceConfig:
        self.require_exists()
        try:
            raw = json.loads(self.paths.config_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ValidationFailed(f"Invalid {CONFIG_FILE}: {exc.msg}") from exc
        return WorkspaceConfig.model_validate(raw)

    def write_config(self, config: WorkspaceConfig) -> None:
        content = json.dumps(
            config.model_dump(mode="json", by_alias=True),
            ensure_ascii=False,
            sort_keys=True,
            indent=2,
        )
        atomic_write_text(self.paths.config_file, content + "\n")

    def _install_bundled_skills(self) -> None:
        source = _bundled_skills_source()
        if source is None:
            return

        target_root = self.root / AGENT_SKILLS_DIR
        for source_path in sorted(source.rglob("*")):
            relative = source_path.relative_to(source)
            target_path = target_root / relative
            if source_path.is_dir():
                if not target_path.exists():
                    target_path.mkdir(parents=True, exist_ok=True)
                continue
            if not source_path.is_file() or target_path.exists():
                continue
            if target_path.parent.exists() and not target_path.parent.is_dir():
                continue
            target_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_path, target_path)


def _bundled_skills_source() -> Path | None:
    development_source = Path(__file__).resolve().parents[3] / AGENT_SKILLS_DIR
    if development_source.exists():
        return development_source

    packaged_source = Path(__file__).resolve().parents[1] / "assets" / "agents" / "skills"
    if packaged_source.exists():
        return packaged_source
    return None
