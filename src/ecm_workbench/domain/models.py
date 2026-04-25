from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = "1.0"
CapabilityKind = Literal["abstract", "leaf"]
LifecycleStatus = Literal["Draft", "Active", "Deprecated", "Retired"]


def now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def new_id() -> str:
    return str(uuid4())


class JsonModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class Capability(JsonModel):
    record_type: Literal["capability"] = Field("capability", alias="_t")
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    id: str = Field(default_factory=new_id)
    name: Annotated[str, Field(min_length=1)]
    aliases: list[str] = Field(default_factory=list)
    description: str = ""
    domain: str = ""
    type: CapabilityKind = "leaf"
    parent_id: str | None = None
    order: int = Field(default=0, ge=0)
    lifecycle_status: LifecycleStatus = "Draft"
    effective_from: str | None = None
    effective_to: str | None = None
    rationale: str = ""
    source_references: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    steward_id: str = ""
    steward_department: str = ""
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)

    def durable_dict(self) -> dict:
        return self.model_dump(mode="json", by_alias=True)


class CapabilityCreate(JsonModel):
    name: Annotated[str, Field(min_length=1)]
    parent_id: str | None = None
    aliases: list[str] = Field(default_factory=list)
    description: str = ""
    domain: str = ""
    type: CapabilityKind = "leaf"
    lifecycle_status: LifecycleStatus = "Draft"
    effective_from: str | None = None
    effective_to: str | None = None
    rationale: str = ""
    source_references: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    steward_id: str = ""
    steward_department: str = ""


class CapabilityPatch(JsonModel):
    name: str | None = None
    aliases: list[str] | None = None
    description: str | None = None
    domain: str | None = None
    type: CapabilityKind | None = None
    lifecycle_status: LifecycleStatus | None = None
    effective_from: str | None = None
    effective_to: str | None = None
    rationale: str | None = None
    source_references: list[str] | None = None
    tags: list[str] | None = None
    steward_id: str | None = None
    steward_department: str | None = None


class CapabilityTreeNode(JsonModel):
    capability: Capability
    children: list[CapabilityTreeNode] = Field(default_factory=list)


class WorkspaceConfig(JsonModel):
    record_type: Literal["workspace"] = Field("workspace", alias="_t")
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    name: str
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
