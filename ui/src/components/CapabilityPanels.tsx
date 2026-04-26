import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  dragAndDropFeature,
  hotkeysCoreFeature,
  isOrderedDragTarget,
  syncDataLoaderFeature,
} from '@headless-tree/core';
import type { ItemInstance } from '@headless-tree/core';
import { useTree } from '@headless-tree/react';
import { Button, Input, Text, Textarea, Dropdown, Option } from '@fluentui/react-components';
import { ChevronDownRegular, ChevronRightRegular, DragRegular } from '@fluentui/react-icons';
import type { Capability, CapabilityPatch } from '../api/types';
import { api } from '../api/bridge';
import { notify, errorMessage } from '../notifications/notify';
import { useAppStore } from '../store/app-store';
import {
  CAPABILITY_TREE_ROOT_ID,
  CAPABILITY_TREE_REORDER_AREA,
  ROOT_PARENT_OPTION_ID,
  buildCapabilityTreeItems,
  flattenCapabilities,
  fullyExpandedCapabilityItems,
  getCapabilityDropMoveRequest,
  getValidParentCandidates,
  parentIdFromOptionValue,
  parentOptionLabel,
  parentOptionValue,
  reconcileExpandedCapabilityItems,
} from './capability-tree-utils';
import type { CapabilityMoveRequest, CapabilityTreeItemData } from './capability-tree-utils';

function capabilityPatch(draft: Capability): CapabilityPatch {
  return {
    name: draft.name,
    aliases: draft.aliases,
    description: draft.description,
    domain: draft.domain,
    lifecycle_status: draft.lifecycle_status,
    effective_from: draft.effective_from,
    effective_to: draft.effective_to,
    rationale: draft.rationale,
    source_references: draft.source_references,
    tags: draft.tags,
    steward_id: draft.steward_id,
    steward_department: draft.steward_department,
  };
}

function capabilityPatchChanged(draft: Capability, original: Capability | null): boolean {
  return !original || JSON.stringify(capabilityPatch(draft)) !== JSON.stringify(capabilityPatch(original));
}

export function CapabilityTreePanel() {
  const workspace = useAppStore((s) => s.workspace);
  const tree = useAppStore((s) => s.tree);
  const setTree = useAppStore((s) => s.setTree);
  const setSelected = useAppStore((s) => s.setSelected);
  const setError = useAppStore((s) => s.setError);
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [results, setResults] = useState<Capability[]>([]);
  const [expandedItems, setExpandedItems] = useState<string[]>([CAPABILITY_TREE_ROOT_ID]);
  const expansionInitializedFor = useRef<string | null>(null);

  async function refresh(options: {
    initializeExpansion?: boolean;
    selectId?: string | null;
    extraExpandedItems?: string[];
  } = {}) {
    try {
      const next = await api.capabilities.listTree();
      setTree(next);
      const desiredSelectedId = options.selectId ?? useAppStore.getState().selectedId ?? null;
      if (desiredSelectedId) {
        const match = flattenCapabilities(next).find((cap) => cap.id === desiredSelectedId) ?? null;
        setSelected(match);
      }
      if (
        options.initializeExpansion &&
        workspace?.path &&
        expansionInitializedFor.current !== workspace.path
      ) {
        expansionInitializedFor.current = workspace.path;
        setExpandedItems(fullyExpandedCapabilityItems(next));
      } else {
        setExpandedItems((current) => (
          reconcileExpandedCapabilityItems(current, next, options.extraExpandedItems)
        ));
      }
    } catch (error) {
      notify.error({
        intent: 'operation.failed',
        title: 'Could not refresh capabilities',
        body: errorMessage(error),
        source: 'model',
        dedupeKey: `capability.refresh.${workspace?.path ?? 'current'}`,
        action: { label: 'Open capability tree', panelId: 'tree' },
      });
    }
  }

  useEffect(() => {
    expansionInitializedFor.current = null;
    setExpandedItems([CAPABILITY_TREE_ROOT_ID]);
    setResults([]);
    setQuery('');
  }, [workspace?.path]);

  useEffect(() => {
    if (!workspace) return;
    if (expansionInitializedFor.current !== workspace.path) {
      expansionInitializedFor.current = workspace.path;
      setExpandedItems(fullyExpandedCapabilityItems(tree));
      return;
    }
    setExpandedItems((current) => reconcileExpandedCapabilityItems(current, tree));
  }, [workspace?.path, tree]);

  async function create(parentId: string | null) {
    if (!newName.trim()) return;
    try {
      const created = await api.capabilities.create({ name: newName.trim(), parent_id: parentId });
      setNewName('');
      await refresh({
        selectId: created.id,
        extraExpandedItems: [parentId ?? CAPABILITY_TREE_ROOT_ID],
      });
      notify.success({
        intent: 'capability.created',
        title: 'Capability created',
        body: created.name,
        source: 'model',
        dedupeKey: `capability.create.${created.id}`,
        action: { label: 'Open inspector', panelId: 'inspector' },
      });
    } catch (error) {
      notify.error({
        intent: 'operation.failed',
        title: 'Could not create capability',
        body: errorMessage(error),
        source: 'model',
        action: { label: 'Open capability tree', panelId: 'tree' },
      });
    }
  }

  async function moveFromTree(request: CapabilityMoveRequest) {
    try {
      const updated = await api.capabilities.move(request.id, request.parentId, request.order);
      await refresh({
        selectId: updated.id,
        extraExpandedItems: [request.parentId ?? CAPABILITY_TREE_ROOT_ID],
      });
      setError(null);
      notify.success({
        intent: 'capability.moved',
        title: 'Capability moved',
        body: updated.name,
        source: 'model',
        dedupeKey: `capability.move.${request.id}`,
        action: { label: 'Open capability tree', panelId: 'tree' },
      });
    } catch (error) {
      notify.error({
        intent: 'operation.failed',
        title: 'Could not move capability',
        body: errorMessage(error),
        source: 'model',
        dedupeKey: `capability.move.${request.id}`,
        action: { label: 'Open capability tree', panelId: 'tree' },
      });
    }
  }

  async function runSearch(value: string) {
    setQuery(value);
    if (!value.trim()) {
      setResults([]);
      return;
    }
    try {
      const found = await api.search.query(value);
      const ids = new Set(found.map((item) => item.id));
      setResults(flattenCapabilities(tree).filter((item) => ids.has(item.id)));
    } catch (error) {
      notify.error({
        intent: 'operation.failed',
        title: 'Could not search capabilities',
        body: errorMessage(error),
        source: 'model',
        dedupeKey: `capability.search.${value.trim()}`,
        action: { label: 'Open capability tree', panelId: 'tree' },
      });
    }
  }

  const flat = useMemo(() => flattenCapabilities(tree), [tree]);

  return (
    <section className="panel stack capability-tree-panel">
      <div className="toolbar">
        <Input value={query} onChange={(_, data) => void runSearch(data.value)} placeholder="Search capabilities" />
        <Button onClick={() => void refresh()}>Refresh</Button>
      </div>
      <div className="toolbar">
        <Input value={newName} onChange={(_, data) => setNewName(data.value)} placeholder="New capability name" />
        <AddSelectedCapabilityButton onCreate={create} />
        <Button onClick={() => void create(null)}>Add Root</Button>
      </div>
      {!workspace ? <Text>Open or initialize a workspace first.</Text> : null}
      {query.trim() ? (
        <div className="tree capability-tree-scroll">
          {results.map((capability) => (
            <button key={capability.id} className="tree-row" onClick={() => setSelected(capability)}>
              <span className="tree-name">{capability.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <CapabilityTreeView
          nodes={tree}
          expandedItems={expandedItems}
          setExpandedItems={setExpandedItems}
          onSelect={setSelected}
          onMove={moveFromTree}
        />
      )}
      <Text size={200}>{flat.length} capabilities</Text>
    </section>
  );
}

function AddSelectedCapabilityButton({
  onCreate,
}: {
  onCreate: (parentId: string | null) => Promise<void>;
}) {
  const selectedId = useAppStore((s) => s.selectedId);
  return (
    <Button appearance="primary" onClick={() => void onCreate(selectedId)}>
      Add
    </Button>
  );
}

function CapabilityTreeView({
  nodes,
  expandedItems,
  setExpandedItems,
  onSelect,
  onMove,
}: {
  nodes: Capability[];
  expandedItems: string[];
  setExpandedItems: Dispatch<SetStateAction<string[]>>;
  onSelect: (capability: Capability | null) => void;
  onMove: (request: CapabilityMoveRequest) => Promise<void>;
}) {
  const itemsById = useMemo(() => buildCapabilityTreeItems(nodes), [nodes]);
  const capabilityTree = useTree<CapabilityTreeItemData>({
    rootItemId: CAPABILITY_TREE_ROOT_ID,
    indent: 20,
    canReorder: true,
    reorderAreaPercentage: CAPABILITY_TREE_REORDER_AREA,
    openOnDropDelay: 500,
    seperateDragHandle: true,
    state: { expandedItems },
    setExpandedItems,
    dataLoader: {
      getItem: (itemId) => itemsById[itemId] ?? {
        id: itemId,
        name: 'Missing capability',
        capability: null,
        childrenIds: [],
      },
      getChildren: (itemId) => itemsById[itemId]?.childrenIds ?? [],
    },
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getId() === CAPABILITY_TREE_ROOT_ID || item.getItemData().capability !== null,
    canDrag: (items) => items.length === 1 && items[0].getId() !== CAPABILITY_TREE_ROOT_ID,
    canDrop: (items, target) => (
      getCapabilityDropMoveRequest(
        items.map((item) => item.getId()),
        target,
        isOrderedDragTarget(target),
      ) !== null
    ),
    onDrop: async (items, target) => {
      const request = getCapabilityDropMoveRequest(
        items.map((item) => item.getId()),
        target,
        isOrderedDragTarget(target),
      );
      if (request) await onMove(request);
    },
    onPrimaryAction: (item) => onSelect(item.getItemData().capability),
    features: [syncDataLoaderFeature, hotkeysCoreFeature, dragAndDropFeature],
  });

  useEffect(() => {
    capabilityTree.rebuildTree();
  }, [capabilityTree, itemsById]);

  return (
    <div {...capabilityTree.getContainerProps('Capability tree')} className="tree capability-tree-scroll">
      {capabilityTree.getItems().map((item) => (
        <CapabilityTreeRow key={item.getKey()} item={item} />
      ))}
      <div style={capabilityTree.getDragLineStyle()} className="tree-drag-line" />
    </div>
  );
}

function CapabilityTreeRow({
  item,
}: {
  item: ItemInstance<CapabilityTreeItemData>;
}) {
  const isSelected = useAppStore((s) => s.selectedId === item.getId());
  const data = item.getItemData();
  const hasChildren = data.childrenIds.length > 0;
  const expanded = item.isExpanded();
  const rowProps = item.getProps();
  const dragHandleProps = item.getDragHandleProps();
  const classes = [
    'tree-row',
    'headless-tree-row',
    isSelected ? 'selected' : '',
    item.isFocused() ? 'focused' : '',
    item.isDraggingOver() ? 'drag-over' : '',
    item.isUnorderedDragTarget() ? 'drop-inside' : '',
    item.isDragTargetAbove() ? 'drop-before' : '',
    item.isDragTargetBelow() ? 'drop-after' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      {...rowProps}
      className={classes}
      style={{ paddingLeft: 8 + item.getItemMeta().level * 20 }}
    >
      <button
        className={`tree-toggle ${hasChildren ? '' : 'empty'}`}
        type="button"
        aria-label={expanded ? `Collapse ${data.name}` : `Expand ${data.name}`}
        disabled={!hasChildren}
        onClick={(event) => {
          event.stopPropagation();
          if (!hasChildren) return;
          if (expanded) item.collapse();
          else item.expand();
        }}
      >
        {hasChildren ? (expanded ? <ChevronDownRegular /> : <ChevronRightRegular />) : null}
      </button>
      <span
        {...dragHandleProps}
        className="tree-drag-handle"
        title={`Move ${data.name}`}
        aria-label={`Move ${data.name}`}
        onClick={(event) => event.stopPropagation()}
      >
        <DragRegular />
      </span>
      <span className="tree-name">{data.name}</span>
    </div>
  );
}

export function InspectorPanel() {
  const selected = useAppStore((s) => s.selected);
  const tree = useAppStore((s) => s.tree);
  const setSelected = useAppStore((s) => s.setSelected);
  const setTree = useAppStore((s) => s.setTree);
  const setError = useAppStore((s) => s.setError);
  const [draft, setDraft] = useState<Capability | null>(selected);
  const visibleDraft = selected && draft?.id !== selected.id ? selected : draft;

  useEffect(() => setDraft(selected ? { ...selected } : null), [selected]);

  async function save() {
    if (!visibleDraft) return;
    try {
      const metadataChanged = capabilityPatchChanged(visibleDraft, selected);
      const parentChanged = visibleDraft.parent_id !== (selected?.parent_id ?? null);
      if (!metadataChanged && !parentChanged) {
        setError(null);
        return;
      }
      const final = await api.capabilities.save(
        visibleDraft.id,
        capabilityPatch(visibleDraft),
        visibleDraft.parent_id,
      );
      const nextTree = await api.capabilities.listTree();
      setTree(nextTree);
      setSelected(flattenCapabilities(nextTree).find((capability) => capability.id === final.id) ?? final);
      setError(null);
      notify.success({
        intent: parentChanged ? 'capability.moved' : 'capability.updated',
        title: parentChanged ? 'Capability moved' : 'Capability saved',
        body: final.name,
        source: 'model',
        dedupeKey: parentChanged ? `capability.move.${visibleDraft.id}` : `capability.save.${visibleDraft.id}`,
        action: { label: 'Open inspector', panelId: 'inspector' },
      });
    } catch (error) {
      notify.error({
        intent: 'operation.failed',
        title: 'Could not save capability',
        body: errorMessage(error),
        source: 'model',
        dedupeKey: `capability.save.${visibleDraft.id}`,
        action: { label: 'Open inspector', panelId: 'inspector' },
      });
    }
  }

  const candidates = useMemo(
    () => getValidParentCandidates(tree, visibleDraft),
    [tree, visibleDraft?.id],
  );

  if (!visibleDraft) return <section className="panel"><Text>Select a capability.</Text></section>;

  return (
    <section className="panel stack inspector">
      <Text weight="semibold">Capability Inspector</Text>
      <label>Name<Input value={visibleDraft.name} onChange={(_, d) => setDraft({ ...visibleDraft, name: d.value })} /></label>
      <label>Domain<Input value={visibleDraft.domain} onChange={(_, d) => setDraft({ ...visibleDraft, domain: d.value })} /></label>
      <label>Status
        <Dropdown selectedOptions={[visibleDraft.lifecycle_status]} value={visibleDraft.lifecycle_status} onOptionSelect={(_, d) => setDraft({ ...visibleDraft, lifecycle_status: d.optionValue as Capability['lifecycle_status'] })}>
          <Option value="Draft">Draft</Option>
          <Option value="Active">Active</Option>
          <Option value="Deprecated">Deprecated</Option>
          <Option value="Retired">Retired</Option>
        </Dropdown>
      </label>
      <label>Description<Textarea value={visibleDraft.description} onChange={(_, d) => setDraft({ ...visibleDraft, description: d.value })} /></label>
      <label>Aliases<Input value={visibleDraft.aliases.join('; ')} onChange={(_, d) => setDraft({ ...visibleDraft, aliases: d.value.split(';').map((v) => v.trim()).filter(Boolean) })} /></label>
      <label>Tags<Input value={visibleDraft.tags.join('; ')} onChange={(_, d) => setDraft({ ...visibleDraft, tags: d.value.split(';').map((v) => v.trim()).filter(Boolean) })} /></label>
      <label>Steward<Input value={visibleDraft.steward_id} onChange={(_, d) => setDraft({ ...visibleDraft, steward_id: d.value })} /></label>
      <label>Steward Department<Input value={visibleDraft.steward_department} onChange={(_, d) => setDraft({ ...visibleDraft, steward_department: d.value })} /></label>
      <label>Move under
        <Dropdown
          selectedOptions={[parentOptionValue(visibleDraft.parent_id)]}
          value={parentOptionLabel(visibleDraft.parent_id, candidates)}
          onOptionSelect={(_, d) => setDraft({
            ...visibleDraft,
            parent_id: parentIdFromOptionValue(d.optionValue),
          })}
        >
          <Option value={ROOT_PARENT_OPTION_ID}>Top level</Option>
          {candidates.map((candidate) => <Option key={candidate.id} value={candidate.id}>{candidate.name}</Option>)}
        </Dropdown>
      </label>
      <div className="toolbar"><Button appearance="primary" onClick={() => void save()}>Save</Button></div>
    </section>
  );
}
