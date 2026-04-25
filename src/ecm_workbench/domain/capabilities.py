from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable

from .errors import CycleDetected, DuplicateName, ValidationFailed
from .models import Capability, CapabilityCreate, CapabilityPatch, CapabilityTreeNode, now_iso


def normalize_name(name: str) -> str:
    return " ".join(name.strip().lower().split())


def assert_unique_name(
    capabilities: Iterable[Capability], name: str, exclude_id: str | None = None
) -> None:
    wanted = normalize_name(name)
    for capability in capabilities:
        if capability.id != exclude_id and normalize_name(capability.name) == wanted:
            raise DuplicateName(name)


def get_capability(capabilities: Iterable[Capability], capability_id: str) -> Capability:
    for capability in capabilities:
        if capability.id == capability_id:
            return capability
    raise ValidationFailed(f'Capability "{capability_id}" does not exist.')


def assert_parent_exists(capabilities: Iterable[Capability], parent_id: str | None) -> None:
    if parent_id is None:
        return
    get_capability(capabilities, parent_id)


def is_descendant(
    capabilities: Iterable[Capability], maybe_descendant_id: str, ancestor_id: str
) -> bool:
    by_id = {capability.id: capability for capability in capabilities}
    current = by_id.get(maybe_descendant_id)
    seen: set[str] = set()
    while current is not None and current.parent_id is not None:
        if current.parent_id == ancestor_id:
            return True
        if current.parent_id in seen:
            raise CycleDetected()
        seen.add(current.parent_id)
        current = by_id.get(current.parent_id)
    return False


def next_order(capabilities: Iterable[Capability], parent_id: str | None) -> int:
    sibling_orders = [
        capability.order for capability in capabilities if capability.parent_id == parent_id
    ]
    return max(sibling_orders, default=-1) + 1


def create_capability(capabilities: list[Capability], input_data: CapabilityCreate) -> Capability:
    name = input_data.name.strip()
    if not name:
        raise ValidationFailed("Capability name is required.")
    assert_unique_name(capabilities, name)
    assert_parent_exists(capabilities, input_data.parent_id)
    data = input_data.model_dump(mode="json")
    data["name"] = name
    data["order"] = next_order(capabilities, input_data.parent_id)
    return Capability(**data)


def update_capability(
    capabilities: list[Capability], capability_id: str, patch: CapabilityPatch
) -> Capability:
    capability = get_capability(capabilities, capability_id)
    data = patch.model_dump(exclude_unset=True, mode="json")
    if "name" in data and data["name"] is not None:
        data["name"] = data["name"].strip()
        if not data["name"]:
            raise ValidationFailed("Capability name is required.")
        assert_unique_name(capabilities, data["name"], exclude_id=capability_id)
    data["updated_at"] = now_iso()
    return capability.model_copy(update=data)


def move_capability(
    capabilities: list[Capability],
    capability_id: str,
    new_parent_id: str | None,
    order: int | None = None,
) -> Capability:
    capability = get_capability(capabilities, capability_id)
    assert_parent_exists(capabilities, new_parent_id)
    if new_parent_id == capability_id:
        raise CycleDetected()
    if new_parent_id is not None and is_descendant(capabilities, new_parent_id, capability_id):
        raise CycleDetected()
    if order is None:
        order = next_order(capabilities, new_parent_id)
    return capability.model_copy(
        update={"parent_id": new_parent_id, "order": max(0, order), "updated_at": now_iso()}
    )


def replace_capability(capabilities: list[Capability], updated: Capability) -> list[Capability]:
    return [updated if capability.id == updated.id else capability for capability in capabilities]


def sort_capabilities_depth_first(capabilities: Iterable[Capability]) -> list[Capability]:
    by_parent: dict[str | None, list[Capability]] = defaultdict(list)
    all_ids = {capability.id for capability in capabilities}
    for capability in capabilities:
        parent_id = capability.parent_id if capability.parent_id in all_ids else None
        by_parent[parent_id].append(capability)
    for siblings in by_parent.values():
        siblings.sort(key=lambda c: (c.order, normalize_name(c.name), c.id))

    result: list[Capability] = []
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(parent_id: str | None) -> None:
        for capability in by_parent.get(parent_id, []):
            if capability.id in visiting:
                raise CycleDetected()
            if capability.id in visited:
                continue
            visiting.add(capability.id)
            result.append(capability)
            visit(capability.id)
            visiting.remove(capability.id)
            visited.add(capability.id)

    visit(None)
    for capability in sorted(capabilities, key=lambda c: c.id):
        if capability.id not in visited:
            result.append(capability)
    return result


def build_tree(capabilities: Iterable[Capability]) -> list[CapabilityTreeNode]:
    sorted_capabilities = sort_capabilities_depth_first(capabilities)
    nodes = {
        capability.id: CapabilityTreeNode(capability=capability)
        for capability in sorted_capabilities
    }
    roots: list[CapabilityTreeNode] = []
    for capability in sorted_capabilities:
        node = nodes[capability.id]
        if capability.parent_id is None or capability.parent_id not in nodes:
            roots.append(node)
        else:
            nodes[capability.parent_id].children.append(node)
    return roots


def capability_path(capabilities: Iterable[Capability], capability_id: str) -> list[Capability]:
    by_id = {capability.id: capability for capability in capabilities}
    current = by_id.get(capability_id)
    if current is None:
        raise ValidationFailed(f'Capability "{capability_id}" does not exist.')
    path: list[Capability] = []
    seen: set[str] = set()
    while current is not None:
        if current.id in seen:
            raise CycleDetected()
        path.append(current)
        seen.add(current.id)
        current = by_id.get(current.parent_id) if current.parent_id else None
    path.reverse()
    return path
