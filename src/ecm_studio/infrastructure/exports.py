from __future__ import annotations

import csv
import json
from pathlib import Path

from ecm_studio.domain.models import Capability


class ExportService:
    def export_json(self, path: Path, capabilities: list[Capability]) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                [capability.durable_dict() for capability in capabilities], indent=2, sort_keys=True
            ),
            encoding="utf-8",
        )
        return path

    def export_csv(self, path: Path, capabilities: list[Capability]) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=[
                    "id",
                    "name",
                    "parent_id",
                    "order",
                    "domain",
                    "type",
                    "lifecycle_status",
                    "description",
                    "aliases",
                    "tags",
                    "steward_id",
                    "steward_department",
                    "replacement_capability_id",
                ],
            )
            writer.writeheader()
            for capability in capabilities:
                writer.writerow(
                    {
                        "id": capability.id,
                        "name": capability.name,
                        "parent_id": capability.parent_id or "",
                        "order": capability.order,
                        "domain": capability.domain,
                        "type": capability.type,
                        "lifecycle_status": capability.lifecycle_status,
                        "description": capability.description,
                        "aliases": ";".join(capability.aliases),
                        "tags": ";".join(capability.tags),
                        "steward_id": capability.steward_id,
                        "steward_department": capability.steward_department,
                        "replacement_capability_id": capability.replacement_capability_id
                        or "",
                    }
                )
        return path
