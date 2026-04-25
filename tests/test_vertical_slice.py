from __future__ import annotations

from pathlib import Path

import pytest

from ecm_studio.application.services import AppServices
from ecm_studio.domain.errors import CycleDetected, JsonlParseFailed, ValidationFailed
from ecm_studio.infrastructure.jsonl import read_raw_jsonl


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

    sqlite_file = tmp_path / ".ecm-studio" / "cache" / "ecm.sqlite"
    sqlite_file.unlink()
    reopened = AppServices(settings_path=tmp_path / "settings.json")
    reopened.workspace.open(str(tmp_path))
    assert reopened.capabilities.list_tree()[0]["name"] == "Customer"


def test_failed_open_preserves_current_workspace(tmp_path: Path) -> None:
    services = AppServices(settings_path=tmp_path / "settings.json")
    good = tmp_path / "good"
    services.workspace.init(str(good), "Good")

    with pytest.raises(ValidationFailed):
        services.workspace.open(str(tmp_path / "missing"))

    assert services.workspace.status()["path"] == str(good.resolve())


def test_invalid_repository_structure_blocks_tree_and_reports_diagnostics(tmp_path: Path) -> None:
    services = AppServices(settings_path=tmp_path / "settings.json")
    services.workspace.init(str(tmp_path), "Invalid Structure")
    capabilities_file = tmp_path / "ecm" / "capabilities.jsonl"
    capabilities_file.write_text(
        '{"_t":"capability","schema_version":"1.0","id":"a","name":"A","parent_id":"b"}\n'
        '{"_t":"capability","schema_version":"1.0","id":"b","name":"B","parent_id":"a"}\n',
        encoding="utf-8",
    )

    with pytest.raises(JsonlParseFailed):
        services.capabilities.list_tree()

    diagnostics = services.diagnostics.run()
    assert diagnostics[0]["code"] == "CYCLE_DETECTED"
    assert diagnostics[0]["path"] == "ecm/capabilities.jsonl"


def test_update_from_tree_dto_persists_jsonl_sqlite_and_audit(tmp_path: Path) -> None:
    services = AppServices(settings_path=tmp_path / "settings.json")
    services.workspace.init(str(tmp_path), "Update Pipeline")
    root = services.capabilities.create({"name": "Customer", "type": "abstract"})
    services.capabilities.create({"name": "Customer Onboarding", "parent_id": root["id"]})

    child_from_tree = services.capabilities.list_tree()[0]["children"][0]
    patch_from_inspector = {
        **child_from_tree,
        "name": "Customer Activation",
        "domain": "Customer Experience",
        "tags": ["customer", "activation"],
    }

    updated = services.capabilities.update(child_from_tree["id"], patch_from_inspector)

    assert updated["name"] == "Customer Activation"
    capabilities_file = tmp_path / "ecm" / "capabilities.jsonl"
    capabilities = read_raw_jsonl(capabilities_file).records
    assert capabilities[1]["name"] == "Customer Activation"
    assert "children" not in capabilities[1]
    assert services.search.query("activation")[0]["name"] == "Customer Activation"

    audit_file = tmp_path / "ecm" / "capability_versions.jsonl"
    events = read_raw_jsonl(audit_file).records
    update_events = [event for event in events if event.get("action") == "update"]
    assert update_events
    assert update_events[-1]["capability_id"] == child_from_tree["id"]
    assert update_events[-1]["patch"]["name"] == "Customer Activation"


def test_capability_save_validates_update_and_move_before_writing(tmp_path: Path) -> None:
    services = AppServices(settings_path=tmp_path / "settings.json")
    services.workspace.init(str(tmp_path), "Atomic Save")
    root = services.capabilities.create({"name": "Root"})
    child = services.capabilities.create({"name": "Child", "parent_id": root["id"]})
    capabilities_file = tmp_path / "ecm" / "capabilities.jsonl"
    before = capabilities_file.read_text(encoding="utf-8")

    with pytest.raises(CycleDetected):
        services.capabilities.save(child["id"], {"name": "Renamed Child"}, child["id"])

    assert capabilities_file.read_text(encoding="utf-8") == before
    assert services.capabilities.get(child["id"])["name"] == "Child"


def test_capability_save_persists_metadata_and_move_once(tmp_path: Path) -> None:
    services = AppServices(settings_path=tmp_path / "settings.json")
    services.workspace.init(str(tmp_path), "Combined Save")
    root = services.capabilities.create({"name": "Root"})
    target = services.capabilities.create({"name": "Target"})
    child = services.capabilities.create({"name": "Child", "parent_id": root["id"]})

    saved = services.capabilities.save(
        child["id"],
        {"name": "Renamed Child", "domain": "Operations"},
        target["id"],
    )

    assert saved["name"] == "Renamed Child"
    assert saved["parent_id"] == target["id"]
    events = read_raw_jsonl(tmp_path / "ecm" / "capability_versions.jsonl").records
    combined_events = [
        event for event in events if event.get("capability_id") == child["id"]
    ][-2:]
    assert [event["action"] for event in combined_events] == ["update", "move"]


def test_capability_type_is_computed_from_hierarchy(tmp_path: Path) -> None:
    services = AppServices(settings_path=tmp_path / "settings.json")
    services.workspace.init(str(tmp_path), "Computed Type")

    root = services.capabilities.create({"name": "Root", "type": "abstract"})
    assert root["type"] == "leaf"

    child = services.capabilities.create({"name": "Child", "parent_id": root["id"]})
    tree = services.capabilities.list_tree()
    assert tree[0]["type"] == "abstract"
    assert tree[0]["children"][0]["type"] == "leaf"

    services.capabilities.update(child["id"], {**child, "type": "abstract", "domain": "Ignored"})
    tree = services.capabilities.list_tree()
    assert tree[0]["children"][0]["type"] == "leaf"

    services.capabilities.move(child["id"], None)
    tree = services.capabilities.list_tree()
    by_name = {capability["name"]: capability for capability in tree}
    assert by_name["Root"]["type"] == "leaf"
    assert by_name["Child"]["type"] == "leaf"

    records = read_raw_jsonl(tmp_path / "ecm" / "capabilities.jsonl").records
    assert {record["name"]: record["type"] for record in records} == {
        "Root": "leaf",
        "Child": "leaf",
    }


def test_move_persists_order_sqlite_and_audit(tmp_path: Path) -> None:
    services = AppServices(settings_path=tmp_path / "settings.json")
    services.workspace.init(str(tmp_path), "Move Pipeline")

    root = services.capabilities.create({"name": "Root"})
    services.capabilities.create({"name": "Capability A", "parent_id": root["id"]})
    services.capabilities.create({"name": "Capability B", "parent_id": root["id"]})
    moved = services.capabilities.create({"name": "Capability C", "parent_id": root["id"]})

    updated = services.capabilities.move(moved["id"], root["id"], 0)

    assert updated["parent_id"] == root["id"]
    assert updated["order"] == 0
    tree = services.capabilities.list_tree()
    assert [child["name"] for child in tree[0]["children"]] == [
        "Capability C",
        "Capability A",
        "Capability B",
    ]

    records = read_raw_jsonl(tmp_path / "ecm" / "capabilities.jsonl").records
    assert [
        (record["name"], record["order"])
        for record in records
        if record.get("parent_id") == root["id"]
    ] == [
        ("Capability C", 0),
        ("Capability A", 1),
        ("Capability B", 2),
    ]
    assert services.search.query("Capability C")[0]["name"] == "Capability C"

    events = read_raw_jsonl(tmp_path / "ecm" / "capability_versions.jsonl").records
    move_events = [event for event in events if event.get("action") == "move"]
    assert move_events
    assert move_events[-1]["capability_id"] == moved["id"]
    assert move_events[-1]["patch"] == {"parent_id": root["id"], "order": 0}
