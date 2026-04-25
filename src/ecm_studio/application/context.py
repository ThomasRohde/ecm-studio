from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ecm_studio.domain.errors import WorkspaceNotOpen
from ecm_studio.infrastructure.workspace import WorkspaceRepository


@dataclass
class AppContext:
    workspace: WorkspaceRepository | None = None

    def open_workspace(self, path: Path) -> WorkspaceRepository:
        workspace = WorkspaceRepository(path)
        workspace.require_exists()
        self.workspace = workspace
        return workspace

    def init_workspace(self, path: Path, name: str) -> WorkspaceRepository:
        workspace = WorkspaceRepository(path)
        workspace.init(name)
        self.workspace = workspace
        return workspace

    def require_workspace(self) -> WorkspaceRepository:
        if self.workspace is None:
            raise WorkspaceNotOpen()
        self.workspace.require_exists()
        return self.workspace
