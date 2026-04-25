from __future__ import annotations

import json
from pathlib import Path

from ecm_workbench.application.services import AppServices
from ecm_workbench.domain.models import Capability
from ecm_workbench.infrastructure.repository import CapabilityRepository


def test_import_csv_append_can_reference_existing_parent(tmp_path: Path) -> None:
    services = AppServices(settings_path=tmp_path / "settings.json")
    workspace = services.workspace.init(str(tmp_path / "workspace"), "Import")
    root = services.capabilities.create({"name": "Payments", "type": "abstract"})

    source = tmp_path / "capabilities.csv"
    source.write_text(
        "id,name,parent_id,order,domain,type,lifecycle_status,description,aliases,tags,"
        "steward_id,steward_department\n"
        f"child-1,Domestic Payments,{root['id']},0,Banking,leaf,Draft,"
        "Handles domestic settlement,Local transfers,money,owner,Banking\n",
        encoding="utf-8",
    )

    preview = services.models.import_preview(str(source), "append")
    result = services.models.import_apply(str(source), "append")
    tree = services.capabilities.list_tree()

    assert workspace["initialized"] is True
    assert preview["added"] == 1
    assert result["applied"] is True
    assert tree[0]["children"][0]["name"] == "Domestic Payments"


def test_replace_import_from_json_bundle_checkpoints_and_rebuilds(tmp_path: Path) -> None:
    services = AppServices(settings_path=tmp_path / "settings.json")
    workspace_root = tmp_path / "workspace"
    services.workspace.init(str(workspace_root), "Replace")
    services.git.checkpoint("Initial workspace")

    capability = Capability(id="capability-1", name="Customer Management")
    source = tmp_path / "bundle.json"
    source.write_text(
        json.dumps(
            {
                "_t": "ecm_model_bundle",
                "schema_version": "1.0",
                "capabilities": [capability.durable_dict()],
            }
        ),
        encoding="utf-8",
    )

    result = services.models.import_apply(str(source), "replace")

    assert result["checkpoint_id"]
    assert result["rebuild"]["capability_count"] == 1
    assert services.capabilities.list_tree()[0]["name"] == "Customer Management"


def test_replace_import_reports_invalid_parent(tmp_path: Path) -> None:
    services = AppServices(settings_path=tmp_path / "settings.json")
    workspace_root = tmp_path / "workspace"
    services.workspace.init(str(workspace_root), "Invalid")
    source = workspace_root / "bad.jsonl"
    CapabilityRepository(source).save(
        [Capability(id="child", name="Child", parent_id="missing-parent")]
    )

    preview = services.models.import_preview(str(source), "replace")

    assert preview["invalid"] == 1
    assert preview["diagnostics"][0]["code"] == "VALIDATION_FAILED"


def test_model_export_writes_all_supported_formats(tmp_path: Path) -> None:
    services = AppServices(settings_path=tmp_path / "settings.json")
    workspace_root = tmp_path / "workspace"
    services.workspace.init(str(workspace_root), "Export")
    services.capabilities.create({"name": "Payments"})

    jsonl = services.models.export("jsonl")
    csv = services.models.export("csv")
    bundle = services.models.export("json_bundle")

    assert Path(jsonl["path"]).exists()
    assert Path(csv["path"]).exists()
    assert Path(bundle["path"]).exists()
