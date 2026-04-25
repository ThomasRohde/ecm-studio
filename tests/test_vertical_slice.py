from __future__ import annotations

from pathlib import Path

from ecm_workbench.application.services import AppServices


def test_workspace_vertical_slice(tmp_path: Path) -> None:
    services = AppServices(settings_path=tmp_path / "settings.json")
    workspace = services.workspace.init(str(tmp_path), "Slice")
    assert workspace["initialized"] is True

    root = services.capabilities.create({"name": "Customer", "type": "abstract"})
    child = services.capabilities.create({"name": "Customer Onboarding", "parent_id": root["id"]})
    assert child["parent_id"] == root["id"]

    tree = services.capabilities.list_tree()
    assert tree[0]["children"][0]["name"] == "Customer Onboarding"
    assert services.search.query("onboarding")[0]["name"] == "Customer Onboarding"

    checkpoint = services.git.checkpoint("Add customer capabilities")
    assert checkpoint["id"]

    sqlite_file = tmp_path / ".ecm-workbench" / "cache" / "ecm.sqlite"
    sqlite_file.unlink()
    reopened = AppServices(settings_path=tmp_path / "settings.json")
    reopened.workspace.open(str(tmp_path))
    assert reopened.capabilities.list_tree()[0]["name"] == "Customer"
