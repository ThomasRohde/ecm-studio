from __future__ import annotations

import pytest

from ecm_studio.domain.capabilities import (
    build_tree,
    create_capability,
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
