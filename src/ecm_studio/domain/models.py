from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = "1.0"
DEFAULT_CAPABILITY_MAP_TARGET_ASPECT_RATIO = 1.7777777778
DEFAULT_CAPABILITY_MAP_DEPTH_COLORS = [
    "#D6E4F0",
    "#D9EAD3",
    "#E1D5E7",
    "#FCE5CD",
    "#FFF2CC",
    "#F4CCCC",
]
DEFAULT_CAPABILITY_MAP_LEAF_COLOR = "#E8E8E8"
CapabilityKind = Literal["abstract", "leaf"]
LifecycleStatus = Literal["Draft", "Active", "Deprecated", "Retired"]
CapabilityEventAction = Literal[
    "create",
    "update",
    "move",
    "import",
    "retire",
    "delete",
    "merge",
    "promote",
    "demote",
]
HexColor = Annotated[str, Field(pattern=r"^#[0-9A-Fa-f]{6}$")]


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
    replacement_capability_id: str | None = None
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
    replacement_capability_id: str | None = None


class CapabilityPatch(JsonModel):
    name: str | None = None
    aliases: list[str] | None = None
    description: str | None = None
    domain: str | None = None
    lifecycle_status: LifecycleStatus | None = None
    effective_from: str | None = None
    effective_to: str | None = None
    rationale: str | None = None
    source_references: list[str] | None = None
    tags: list[str] | None = None
    steward_id: str | None = None
    steward_department: str | None = None
    replacement_capability_id: str | None = None


class CapabilityTreeNode(JsonModel):
    capability: Capability
    children: list[CapabilityTreeNode] = Field(default_factory=list)


class CapabilityEvent(JsonModel):
    record_type: Literal["capability_version"] = Field("capability_version", alias="_t")
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    id: str = Field(default_factory=new_id)
    capability_id: str
    action: CapabilityEventAction
    summary: str
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    patch: dict[str, Any] = Field(default_factory=dict)
    actor: str = "local"
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)

    def durable_dict(self) -> dict:
        return self.model_dump(mode="json", by_alias=True)


class ModelEvent(JsonModel):
    record_type: Literal["model_version"] = Field("model_version", alias="_t")
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    id: str = Field(default_factory=new_id)
    action: str
    summary: str
    capability_count: int
    source_path: str | None = None
    checkpoint_id: str | None = None
    version_label: str | None = None
    state: str | None = None
    tag: str | None = None
    export_paths: list[str] = Field(default_factory=list)
    released_at: str | None = None
    actor: str = "local"
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)

    def durable_dict(self) -> dict:
        return self.model_dump(mode="json", by_alias=True)


class PublishEvent(JsonModel):
    record_type: Literal["publish_event"] = Field("publish_event", alias="_t")
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    id: str = Field(default_factory=new_id)
    event_type: str
    model_version_id: str | None = None
    tag: str
    github_release_url: str | None = None
    asset_paths: list[str] = Field(default_factory=list)
    delivery_status: str
    published_at: str = Field(default_factory=now_iso)
    actor: str = "local"
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)

    def durable_dict(self) -> dict:
        return self.model_dump(mode="json", by_alias=True)


class CapabilityMapColorScheme(JsonModel):
    depth_colors: Annotated[list[HexColor], Field(min_length=1, max_length=8)] = Field(
        default_factory=lambda: [*DEFAULT_CAPABILITY_MAP_DEPTH_COLORS]
    )
    leaf_color: HexColor = DEFAULT_CAPABILITY_MAP_LEAF_COLOR


class CapabilityMapSettings(JsonModel):
    target_aspect_ratio: Annotated[
        float,
        Field(ge=0.5, le=4.0, allow_inf_nan=False),
    ] = DEFAULT_CAPABILITY_MAP_TARGET_ASPECT_RATIO
    color_scheme: CapabilityMapColorScheme = Field(default_factory=CapabilityMapColorScheme)


class RepositorySettings(JsonModel):
    capability_map: CapabilityMapSettings = Field(default_factory=CapabilityMapSettings)


class WorkspaceConfig(JsonModel):
    record_type: Literal["workspace"] = Field("workspace", alias="_t")
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    name: str
    settings: RepositorySettings = Field(default_factory=RepositorySettings)
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)
