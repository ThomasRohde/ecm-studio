from __future__ import annotations

import pytest

from ecm_studio.domain.capabilities import (
    build_tree,
    create_capability,
    delete_capability,
    get_capability,
    merge_capabilities,
    move_capability,
    replace_capability,
    retire_capability,
    update_capability,
)
from ecm_studio.domain.errors import CycleDetected, DuplicateName, ValidationFailed
from ecm_studio.domain.models import Capability, CapabilityCreate, CapabilityPatch


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


def test_disconnected_cycle_is_rejected_when_building_tree() -> None:
    capabilities = [
        Capability(id="a", name="A", parent_id="b"),
        Capability(id="b", name="B", parent_id="a"),
    ]

    with pytest.raises(CycleDetected):
        build_tree(capabilities)


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


def test_retire_sets_lifecycle_rationale_and_replacement() -> None:
    capabilities = []
    retiring = create_capability(capabilities, CapabilityCreate(name="Old"))
    capabilities.append(retiring)
    replacement = create_capability(capabilities, CapabilityCreate(name="New"))
    capabilities.append(replacement)

    retired = retire_capability(capabilities, retiring.id, "Duplicated", replacement.id)

    assert retired.lifecycle_status == "Retired"
    assert retired.rationale == "Duplicated"
    assert retired.replacement_capability_id == replacement.id
    assert retired.effective_to


def test_delete_only_allows_draft_leaf_capabilities() -> None:
    capabilities = []
    parent = create_capability(capabilities, CapabilityCreate(name="Parent"))
    capabilities.append(parent)
    child = create_capability(capabilities, CapabilityCreate(name="Child", parent_id=parent.id))
    capabilities.append(child)

    with pytest.raises(ValidationFailed, match="Draft leaf"):
        delete_capability(capabilities, parent.id)

    active_child = child.model_copy(update={"lifecycle_status": "Active"})
    active_capabilities = replace_capability(capabilities, active_child)
    with pytest.raises(ValidationFailed, match="Draft leaf"):
        delete_capability(active_capabilities, child.id)

    remaining, deleted = delete_capability(capabilities, child.id)

    assert deleted.id == child.id
    assert [capability.id for capability in remaining] == [parent.id]


def test_merge_moves_children_and_removes_draft_source() -> None:
    capabilities = []
    source = create_capability(capabilities, CapabilityCreate(name="Duplicate", aliases=["Dup"]))
    capabilities.append(source)
    survivor = create_capability(capabilities, CapabilityCreate(name="Canonical"))
    capabilities.append(survivor)
    child = create_capability(capabilities, CapabilityCreate(name="Child", parent_id=source.id))
    capabilities.append(child)

    merged, source_before, source_after, survivor_after, source_removed = merge_capabilities(
        capabilities, source.id, survivor.id, "Same capability"
    )

    assert source_before.id == source.id
    assert source_after is None
    assert source_removed is True
    assert get_capability(merged, child.id).parent_id == survivor.id
    assert survivor_after.aliases == ["Duplicate", "Dup"]
    assert all(capability.id != source.id for capability in merged)


def test_merge_retires_non_draft_source_with_traceability() -> None:
    capabilities = []
    source = create_capability(capabilities, CapabilityCreate(name="Duplicate"))
    source = source.model_copy(update={"lifecycle_status": "Active"})
    capabilities.append(source)
    survivor = create_capability(capabilities, CapabilityCreate(name="Canonical"))
    capabilities.append(survivor)

    merged, _, source_after, survivor_after, source_removed = merge_capabilities(
        capabilities, source.id, survivor.id, "Consolidated"
    )

    assert source_removed is False
    assert source_after is not None
    assert source_after.lifecycle_status == "Retired"
    assert source_after.replacement_capability_id == survivor.id
    assert get_capability(merged, source.id).replacement_capability_id == survivor.id
    assert survivor_after.aliases == ["Duplicate"]


def test_merge_rejects_descendant_survivor_to_prevent_cycles() -> None:
    capabilities = []
    source = create_capability(capabilities, CapabilityCreate(name="Source"))
    capabilities.append(source)
    survivor = create_capability(
        capabilities, CapabilityCreate(name="Survivor", parent_id=source.id)
    )
    capabilities.append(survivor)

    with pytest.raises(ValidationFailed, match="descendant"):
        merge_capabilities(capabilities, source.id, survivor.id, "Consolidated")
