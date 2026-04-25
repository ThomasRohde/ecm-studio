from __future__ import annotations

from pathlib import Path

from ecm_studio.domain.models import Capability
from ecm_studio.infrastructure.jsonl import read_capabilities
from ecm_studio.infrastructure.repository import CapabilityRepository


def test_jsonl_serialization_is_deterministic(tmp_path: Path) -> None:
    path = tmp_path / "capabilities.jsonl"
    repo = CapabilityRepository(path)
    root = Capability(id="00000000-0000-0000-0000-000000000001", name="Root", order=0)
    child = Capability(
        id="00000000-0000-0000-0000-000000000002",
        name="Child",
        parent_id=root.id,
        order=0,
    )

    repo.save([child, root])
    first = path.read_text(encoding="utf-8")
    repo.save([root, child])
    second = path.read_text(encoding="utf-8")

    assert first == second
    assert first.splitlines()[0].find('"name":"Root"') >= 0


def test_jsonl_reports_parse_errors(tmp_path: Path) -> None:
    path = tmp_path / "capabilities.jsonl"
    path.write_text(
        '{"_t":"capability","schema_version":"1.0","id":"x","name":"Ok"}\n{bad}\n', encoding="utf-8"
    )

    capabilities, errors = read_capabilities(path)

    assert len(capabilities) == 1
    assert errors[0].line == 2


def test_jsonl_reports_original_lines_after_blank_and_invalid_records(tmp_path: Path) -> None:
    path = tmp_path / "capabilities.jsonl"
    path.write_text(
        "\n"
        '{"_t":"audit","schema_version":"1.0"}\n'
        '{"_t":"capability","schema_version":"1.0","id":"x","name":"Ok"}\n'
        '{"_t":"capability","schema_version":"1.0","id":"y","name":""}\n',
        encoding="utf-8",
    )

    capabilities, errors = read_capabilities(path)

    assert [capability.name for capability in capabilities] == ["Ok"]
    assert [error.line for error in errors] == [2, 4]


def test_repository_reports_structural_validation_errors(tmp_path: Path) -> None:
    path = tmp_path / "capabilities.jsonl"
    path.write_text(
        '{"_t":"capability","schema_version":"1.0","id":"root","name":"Root"}\n'
        '{"_t":"capability","schema_version":"1.0","id":"dup","name":"Duplicate"}\n'
        '{"_t":"capability","schema_version":"1.0","id":"dup","name":"Other"}\n'
        '{"_t":"capability","schema_version":"1.0","id":"child","name":"Duplicate",'
        '"parent_id":"missing"}\n',
        encoding="utf-8",
    )

    _, errors = CapabilityRepository(path).load()

    assert {error["code"] for error in errors} >= {
        "DUPLICATE_ID",
        "DUPLICATE_NAME",
        "VALIDATION_FAILED",
    }
