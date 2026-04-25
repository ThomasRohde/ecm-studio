from __future__ import annotations

import pytest

from ecm_studio.domain.capabilities import (
    build_tree,
    create_capability,
    get_capability,
    move_capability,
    replace_capability,
    update_capability,
)
from ecm_studio.domain.errors import CycleDetected, DuplicateName
from ecm_studio.domain.models import CapabilityCreate, CapabilityPatch


def test_create_update_and_tree() -> None:
    capabilities = []
    root = create_capability(
        capabilities, CapabilityCreate(name="Customer Management", type="abstract")
    )
    capabilities.append(root)
    child = create_capability(
        capabilities,
        CapabilityCreate(name="Customer Onboarding", parent_id=root.id, tags=["customer"]),
    )
    capabilities.append(child)

    updated = update_capability(
        capabilities, child.id, CapabilityPatch(description="Create customers")
    )
    capabilities = replace_capability(capabilities, updated)

    tree = build_tree(capabilities)
    assert tree[0].capability.id == root.id
    assert tree[0].children[0].capability.description == "Create customers"


def test_duplicate_names_are_rejected() -> None:
    capabilities = [create_capability([], CapabilityCreate(name="Payments"))]
    with pytest.raises(DuplicateName):
        create_capability(capabilities, CapabilityCreate(name=" payments "))


def test_move_cycle_is_rejected() -> None:
    capabilities = []
    root = create_capability(capabilities, CapabilityCreate(name="Root"))
    capabilities.append(root)
    child = create_capability(capabilities, CapabilityCreate(name="Child", parent_id=root.id))
    capabilities.append(child)

    with pytest.raises(CycleDetected):
        move_capability(capabilities, root.id, child.id)


def test_move_reorders_within_same_parent_and_normalizes_orders() -> None:
    capabilities = []
    first = create_capability(capabilities, CapabilityCreate(name="First"))
    capabilities.append(first)
    second = create_capability(capabilities, CapabilityCreate(name="Second"))
    capabilities.append(second)
    third = create_capability(capabilities, CapabilityCreate(name="Third"))
    capabilities.append(third)

    capabilities, moved = move_capability(capabilities, first.id, None, 2)

    assert moved.id == first.id
    assert [node.capability.name for node in build_tree(capabilities)] == [
        "Second",
        "Third",
        "First",
    ]
    assert {capability.name: capability.order for capability in capabilities} == {
        "First": 2,
        "Second": 0,
        "Third": 1,
    }


def test_move_inserts_across_parents_and_normalizes_both_sibling_groups() -> None:
    capabilities = []
    source = create_capability(capabilities, CapabilityCreate(name="Source"))
    capabilities.append(source)
    target = create_capability(capabilities, CapabilityCreate(name="Target"))
    capabilities.append(target)
    first = create_capability(
        capabilities, CapabilityCreate(name="First", parent_id=source.id)
    )
    capabilities.append(first)
    second = create_capability(
        capabilities, CapabilityCreate(name="Second", parent_id=source.id)
    )
    capabilities.append(second)
    third = create_capability(
        capabilities, CapabilityCreate(name="Third", parent_id=source.id)
    )
    capabilities.append(third)
    existing = create_capability(
        capabilities, CapabilityCreate(name="Existing", parent_id=target.id)
    )
    capabilities.append(existing)

    capabilities, moved = move_capability(capabilities, second.id, target.id, 0)

    tree = build_tree(capabilities)
    source_node = next(node for node in tree if node.capability.id == source.id)
    target_node = next(node for node in tree if node.capability.id == target.id)
    source_children = [node.capability.name for node in source_node.children]
    target_children = [node.capability.name for node in target_node.children]
    assert source_children == ["First", "Third"]
    assert target_children == ["Second", "Existing"]
    assert moved.parent_id == target.id
    assert moved.order == 0
    assert get_capability(capabilities, first.id).order == 0
    assert get_capability(capabilities, third.id).order == 1
    assert get_capability(capabilities, existing.id).order == 1


def test_move_without_order_appends_as_child() -> None:
    capabilities = []
    parent = create_capability(capabilities, CapabilityCreate(name="Parent"))
    capabilities.append(parent)
    existing = create_capability(
        capabilities, CapabilityCreate(name="Existing", parent_id=parent.id)
    )
    capabilities.append(existing)
    moved = create_capability(capabilities, CapabilityCreate(name="Moved"))
    capabilities.append(moved)

    capabilities, moved = move_capability(capabilities, moved.id, parent.id)

    assert moved.parent_id == parent.id
    assert moved.order == 1
    parent_node = next(
        node for node in build_tree(capabilities) if node.capability.id == parent.id
    )
    assert [child.capability.name for child in parent_node.children] == [
        "Existing",
        "Moved",
    ]


def test_move_preserves_metadata_and_descendants() -> None:
    capabilities = []
    new_parent = create_capability(capabilities, CapabilityCreate(name="New Parent"))
    capabilities.append(new_parent)
    moved_parent = create_capability(
        capabilities,
        CapabilityCreate(
            name="Moved Parent",
            description="Important metadata",
            tags=["preserved"],
            steward_id="steward",
        ),
    )
    capabilities.append(moved_parent)
    child = create_capability(
        capabilities, CapabilityCreate(name="Child", parent_id=moved_parent.id)
    )
    capabilities.append(child)

    capabilities, moved = move_capability(capabilities, moved_parent.id, new_parent.id)

    assert moved.description == "Important metadata"
    assert moved.tags == ["preserved"]
    assert moved.steward_id == "steward"
    assert get_capability(capabilities, child.id).parent_id == moved_parent.id
