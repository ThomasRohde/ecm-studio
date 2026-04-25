from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

CONFIG_FILE = "ecm-workbench.json"
WORKBENCH_DIR = ".ecm-workbench"
CACHE_DIR = ".ecm-workbench/cache"
LOGS_DIR = ".ecm-workbench/logs"
ECM_DIR = "ecm"
CAPABILITIES_FILE = "ecm/capabilities.jsonl"
CAPABILITY_VERSIONS_FILE = "ecm/capability_versions.jsonl"
MODEL_VERSIONS_FILE = "ecm/model_versions.jsonl"
CHANGE_REQUESTS_FILE = "ecm/change_requests.jsonl"
MAPPINGS_FILE = "ecm/mappings.jsonl"
DOWNSTREAM_CONSUMERS_FILE = "ecm/downstream_consumers.jsonl"
PUBLISH_EVENTS_FILE = "ecm/publish_events.jsonl"
TASKS_FILE = "ecm/tasks.jsonl"
EXPORTS_DIR = "ecm/exports"
SQLITE_FILE = ".ecm-workbench/cache/ecm.sqlite"

MANAGED_PATHS = [
    CONFIG_FILE,
    ".gitignore",
    ECM_DIR,
]

JSONL_FILES = [
    CAPABILITIES_FILE,
    CAPABILITY_VERSIONS_FILE,
    MODEL_VERSIONS_FILE,
    CHANGE_REQUESTS_FILE,
    MAPPINGS_FILE,
    DOWNSTREAM_CONSUMERS_FILE,
    PUBLISH_EVENTS_FILE,
    TASKS_FILE,
]


@dataclass(frozen=True)
class WorkspacePaths:
    root: Path

    @property
    def config_file(self) -> Path:
        return self.root / CONFIG_FILE

    @property
    def cache_dir(self) -> Path:
        return self.root / CACHE_DIR

    @property
    def sqlite_file(self) -> Path:
        return self.root / SQLITE_FILE

    @property
    def ecm_dir(self) -> Path:
        return self.root / ECM_DIR

    @property
    def capabilities_file(self) -> Path:
        return self.root / CAPABILITIES_FILE

    def resolve(self, relative: str) -> Path:
        return self.root / relative
