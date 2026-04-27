import { describe, expect, it } from 'vitest';
import type { Capability } from '../api/types';
import type { TreeItemRef } from './capability-tree-utils';
import {
  CAPABILITY_TREE_REORDER_AREA,
  CAPABILITY_TREE_ROOT_ID,
  getCapabilityDropMoveRequest,
  getValidParentCandidates,
  parentIdFromOptionValue,
  parentOptionLabel,
  parentOptionValue,
  ROOT_PARENT_OPTION_ID,
  reconcileExpandedCapabilityItems,
} from './capability-tree-utils';

function item(id: string, descendantOf: string[] = []): TreeItemRef {
  return {
    getId: () => id,
    isDescendentOf: (parentId) => descendantOf.includes(parentId),
  };
}

function capability(id: string, children: Capability[] = []): Capability {
  return {
    _t: 'capability',
    schema_version: '1.0',
    id,
    name: id,
    aliases: [],
    description: '',
    domain: '',
    type: children.length ? 'abstract' : 'leaf',
    parent_id: null,
    order: 0,
    lifecycle_status: 'Draft',
    effective_from: null,
    effective_to: null,
    rationale: '',
    source_references: [],
    tags: [],
    steward_id: '',
    steward_department: '',
    replacement_capability_id: null,
    created_at: '',
    updated_at: '',
    children,
  };
}

function withParent(node: Capability, parentId: string | null): Capability {
  return { ...node, parent_id: parentId };
}

describe('capability tree utilities', () => {
  it('uses Headless Tree fractional reorder areas', () => {
    expect(CAPABILITY_TREE_REORDER_AREA).toBe(0.25);
    expect(CAPABILITY_TREE_REORDER_AREA).toBeGreaterThan(0);
    expect(CAPABILITY_TREE_REORDER_AREA).toBeLessThan(1);
  });

  it('maps ordered Headless Tree targets to move requests', () => {
    expect(
      getCapabilityDropMoveRequest(
        ['child'],
        {
          item: item('parent'),
          insertionIndex: 2,
        },
        true,
      ),
    ).toEqual({
      id: 'child',
      parentId: 'parent',
      order: 2,
    });
  });

  it('maps unordered targets to append-as-child move requests', () => {
    expect(
      getCapabilityDropMoveRequest(
        ['child'],
        {
          item: item('parent'),
        },
        false,
      ),
    ).toEqual({
      id: 'child',
      parentId: 'parent',
    });
  });

  it('maps synthetic root ordered targets to root-level move requests', () => {
    expect(
      getCapabilityDropMoveRequest(
        ['child'],
        {
          item: item(CAPABILITY_TREE_ROOT_ID),
          insertionIndex: 0,
        },
        true,
      ),
    ).toEqual({
      id: 'child',
      parentId: null,
      order: 0,
    });
  });

  it('rejects self and descendant drops', () => {
    expect(
      getCapabilityDropMoveRequest(
        ['child'],
        {
          item: item('child'),
          insertionIndex: 0,
        },
        true,
      ),
    ).toBeNull();
    expect(
      getCapabilityDropMoveRequest(
        ['parent'],
        {
          item: item('descendant', ['parent']),
          insertionIndex: 0,
        },
        true,
      ),
    ).toBeNull();
  });

  it('preserves only valid expanded item ids', () => {
    const tree = [capability('root', [capability('child')])];
    expect(
      reconcileExpandedCapabilityItems([CAPABILITY_TREE_ROOT_ID, 'root', 'missing'], tree, [
        'child',
      ]),
    ).toEqual([CAPABILITY_TREE_ROOT_ID, 'root', 'child']);
  });

  it('filters invalid manual move parent candidates', () => {
    const child = withParent(capability('child'), 'root');
    const root = capability('root', [child]);
    const sibling = capability('sibling');

    expect(getValidParentCandidates([root, sibling], root).map((item) => item.id)).toEqual([
      'sibling',
    ]);
    expect(getValidParentCandidates([root, sibling], child).map((item) => item.id)).toEqual([
      'root',
      'sibling',
    ]);
  });

  it('maps manual move root option distinctly from real capabilities named root', () => {
    const candidates = [capability('root')];

    expect(parentOptionValue(null)).toBe(ROOT_PARENT_OPTION_ID);
    expect(parentIdFromOptionValue(ROOT_PARENT_OPTION_ID)).toBeNull();
    expect(parentIdFromOptionValue('root')).toBe('root');
    expect(parentOptionLabel(null, candidates)).toBe('Top level');
    expect(parentOptionLabel('root', candidates)).toBe('root');
  });
});
