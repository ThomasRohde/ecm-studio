from __future__ import annotations

from pathlib import Path

import pytest

from ecm_studio.domain.errors import JsonlParseFailed
from ecm_studio.domain.models import Capability
from ecm_studio.infrastructure.repository import CapabilityRepository
from ecm_studio.infrastructure.sqlite_projection import SQLiteProjection
from ecm_studio.infrastructure.workspace import WorkspaceRepository


def test_sqlite_rebuild_and_search(tmp_path: Path) -> None:
    workspace = WorkspaceRepository(tmp_path)
    workspace.init("Test")
    capabilities = [
        Capability(id="00000000-0000-0000-0000-000000000001", name="Payments", domain="Banking"),
        Capability(
            id="00000000-0000-0000-0000-000000000002",
            name="Domestic Payments",
            parent_id="00000000-0000-0000-0000-000000000001",
            aliases=["Local transfers"],
            tags=["money"],
        ),
    ]
    CapabilityRepository(workspace.paths.capabilities_file).save(capabilities)

    projection = SQLiteProjection(workspace)
    result = projection.rebuild()

    assert result.capability_count == 2
    assert projection.is_current()
    assert [row["name"] for row in projection.search("local")] == ["Domestic Payments"]


def test_sqlite_rebuild_handles_large_model(tmp_path: Path) -> None:
    workspace = WorkspaceRepository(tmp_path)
    workspace.init("Large")
    capabilities = [
        Capability(id=f"00000000-0000-0000-0000-{i:012d}", name=f"Capability {i}")
        for i in range(3000)
    ]
    CapabilityRepository(workspace.paths.capabilities_file).save(capabilities)

    result = SQLiteProjection(workspace).rebuild()

    assert result.capability_count == 3000


def test_sqlite_rebuild_fails_on_structural_repository_errors(tmp_path: Path) -> None:
    workspace = WorkspaceRepository(tmp_path)
    workspace.init("Invalid")
    workspace.paths.capabilities_file.write_text(
        '{"_t":"capability","schema_version":"1.0","id":"a","name":"A","parent_id":"b"}\n'
        '{"_t":"capability","schema_version":"1.0","id":"b","name":"B","parent_id":"a"}\n',
        encoding="utf-8",
    )

    with pytest.raises(JsonlParseFailed) as exc:
        SQLiteProjection(workspace).rebuild()

    assert exc.value.detail[0]["code"] == "CYCLE_DETECTED"
