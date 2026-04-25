from __future__ import annotations

from pathlib import Path

from ecm_workbench.domain.capabilities import sort_capabilities_depth_first
from ecm_workbench.domain.models import Capability

from .jsonl import read_capabilities, write_jsonl


class CapabilityRepository:
    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self) -> tuple[list[Capability], list[dict]]:
        capabilities, errors = read_capabilities(self.path)
        return capabilities, [error.to_dict() for error in errors]

    def save(self, capabilities: list[Capability]) -> None:
        ordered = sort_capabilities_depth_first(capabilities)
        write_jsonl(self.path, [capability.durable_dict() for capability in ordered])
