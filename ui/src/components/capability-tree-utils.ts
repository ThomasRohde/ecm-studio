import type { Capability } from '../api/types';

export const CAPABILITY_TREE_ROOT_ID = '__ecm_capability_tree_root__';
export const CAPABILITY_TREE_REORDER_AREA = 0.25;
export const ROOT_PARENT_OPTION_ID = '__ecm_root_parent__';

export interface CapabilityTreeItemData {
  id: string;
  name: string;
  capability: Capability | null;
  childrenIds: string[];
}

export interface TreeItemRef {
  getId: () => string;
  isDescendentOf: (parentId: string) => boolean;
}

export interface TreeDropTargetRef {
  item: TreeItemRef;
  insertionIndex?: number;
}

export interface CapabilityMoveRequest {
  id: string;
  parentId: string | null;
  order?: number;
}

export function flattenCapabilities(nodes: Capability[]): Capability[] {
  return nodes.flatMap((node) => [node, ...flattenCapabilities(node.children ?? [])]);
}

export function isCapabilityDescendant(
  nodes: Capability[],
  maybeDescendantId: string,
  ancestorId: string,
): boolean {
  const byId = new Map(flattenCapabilities(nodes).map((capability) => [capability.id, capability]));
  let current = byId.get(maybeDescendantId);
  const seen = new Set<string>();
  while (current?.parent_id) {
    if (current.parent_id === ancestorId) return true;
    if (seen.has(current.parent_id)) return false;
    seen.add(current.parent_id);
    current = byId.get(current.parent_id);
  }
  return false;
}

export function getValidParentCandidates(nodes: Capability[], draft: Capability | null): Capability[] {
  if (!draft) return [];
  return flattenCapabilities(nodes).filter((capability) => (
    capability.id !== draft.id && !isCapabilityDescendant(nodes, capability.id, draft.id)
  ));
}

export function parentOptionValue(parentId: string | null | undefined): string {
  return parentId ?? ROOT_PARENT_OPTION_ID;
}

export function parentIdFromOptionValue(value: string | undefined): string | null {
  if (!value || value === ROOT_PARENT_OPTION_ID) return null;
  return value;
}

export function parentOptionLabel(parentId: string | null | undefined, candidates: Capability[]): string {
  if (!parentId) return 'Top level';
  return candidates.find((candidate) => candidate.id === parentId)?.name ?? 'Unknown parent';
}

export function buildCapabilityTreeItems(nodes: Capability[]): Record<string, CapabilityTreeItemData> {
  const items: Record<string, CapabilityTreeItemData> = {
    [CAPABILITY_TREE_ROOT_ID]: {
      id: CAPABILITY_TREE_ROOT_ID,
      name: 'Capabilities',
      capability: null,
      childrenIds: nodes.map((node) => node.id),
    },
  };

  function visit(node: Capability) {
    const children = node.children ?? [];
    items[node.id] = {
      id: node.id,
      name: node.name,
      capability: node,
      childrenIds: children.map((child) => child.id),
    };
    for (const child of children) visit(child);
  }

  for (const node of nodes) visit(node);
  return items;
}

export function fullyExpandedCapabilityItems(nodes: Capability[]): string[] {
  return [CAPABILITY_TREE_ROOT_ID, ...flattenCapabilities(nodes).map((node) => node.id)];
}

export function reconcileExpandedCapabilityItems(
  expandedItems: string[],
  nodes: Capability[],
  extraExpandedItems: string[] = [],
): string[] {
  const validIds = new Set([CAPABILITY_TREE_ROOT_ID, ...flattenCapabilities(nodes).map((node) => node.id)]);
  const next = [CAPABILITY_TREE_ROOT_ID, ...expandedItems, ...extraExpandedItems]
    .filter((id) => validIds.has(id));
  return [...new Set(next)];
}

export function getCapabilityDropMoveRequest(
  draggedIds: string[],
  target: TreeDropTargetRef,
  isOrderedTarget: boolean,
): CapabilityMoveRequest | null {
  if (draggedIds.length !== 1) return null;
  const draggedId = draggedIds[0];
  if (draggedId === CAPABILITY_TREE_ROOT_ID) return null;

  const targetId = target.item.getId();
  if (targetId === draggedId) return null;
  if (targetId !== CAPABILITY_TREE_ROOT_ID && target.item.isDescendentOf(draggedId)) {
    return null;
  }

  const parentId = targetId === CAPABILITY_TREE_ROOT_ID ? null : targetId;
  if (isOrderedTarget) {
    return {
      id: draggedId,
      parentId,
      order: target.insertionIndex ?? 0,
    };
  }
  return { id: draggedId, parentId };
}
