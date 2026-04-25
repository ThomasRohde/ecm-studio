from __future__ import annotations

from pathlib import Path

from ecm_studio.domain.capabilities import (
    sort_capabilities_depth_first,
    validate_capability_set,
    with_computed_types,
)
from ecm_studio.domain.models import Capability

from .jsonl import read_capabilities_with_lines, write_jsonl


class CapabilityRepository:
    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self) -> tuple[list[Capability], list[dict]]:
        capabilities, errors, line_numbers = read_capabilities_with_lines(self.path)
        diagnostics = validate_capability_set(
            capabilities,
            path=str(self.path),
            line_numbers=line_numbers,
        )
        return with_computed_types(capabilities), [
            error.to_dict() for error in errors
        ] + [diagnostic.to_dict() for diagnostic in diagnostics]

    def save(self, capabilities: list[Capability]) -> None:
        ordered = sort_capabilities_depth_first(with_computed_types(capabilities))
        write_jsonl(self.path, [capability.durable_dict() for capability in ordered])
