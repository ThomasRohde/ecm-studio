import type { DockviewApi, SerializedDockview } from 'dockview';
import { create } from 'zustand';
import type { ViewSetup } from '../api/types';

export type PanelGroup = 'Workspace' | 'Model' | 'Operations';
export type PanelId =
  | 'workspace'
  | 'repository_settings'
  | 'tree'
  | 'map'
  | 'inspector'
  | 'git'
  | 'import_export'
  | 'diagnostics'
  | 'audit';

export interface PanelDef {
  id: PanelId;
  component: PanelId;
  title: string;
  group: PanelGroup;
  description: string;
}

export const PANEL_DEFS: PanelDef[] = [
  {
    id: 'workspace',
    component: 'workspace',
    title: 'Workspace',
    group: 'Workspace',
    description: 'Open, initialize, and rebuild an ECM workspace.',
  },
  {
    id: 'repository_settings',
    component: 'repository_settings',
    title: 'Repository Settings',
    group: 'Workspace',
    description: 'Edit settings saved with the current ECM workspace.',
  },
  {
    id: 'tree',
    component: 'tree',
    title: 'Capability Tree',
    group: 'Model',
    description: 'Search, browse, and create capabilities.',
  },
  {
    id: 'map',
    component: 'map',
    title: 'Capability Map',
    group: 'Model',
    description: 'Render the capability model with root and depth controls.',
  },
  {
    id: 'inspector',
    component: 'inspector',
    title: 'Inspector',
    group: 'Model',
    description: 'Edit selected capability metadata.',
  },
  {
    id: 'git',
    component: 'git',
    title: 'Git / Checkpoints',
    group: 'Operations',
    description: 'Review Git state and create checkpoints.',
  },
  {
    id: 'import_export',
    component: 'import_export',
    title: 'Import / Export',
    group: 'Operations',
    description: 'Move capability models in and out as JSONL, CSV, or JSON bundle.',
  },
  {
    id: 'diagnostics',
    component: 'diagnostics',
    title: 'Diagnostics',
    group: 'Operations',
    description: 'Run repository and index health checks.',
  },
  {
    id: 'audit',
    component: 'audit',
    title: 'Raw Events / Audit',
    group: 'Operations',
    description: 'Inspect raw event and audit placeholders.',
  },
];

const PANEL_IDS = new Set<string>(PANEL_DEFS.map((panel) => panel.id));
const PANEL_COMPONENTS = new Set<string>(PANEL_DEFS.map((panel) => panel.component));

function defFor(id: PanelId): PanelDef | undefined {
  return PANEL_DEFS.find((panel) => panel.id === id);
}

function panelExists(api: DockviewApi, id: PanelId): boolean {
  return api.panels.some((panel) => panel.id === id);
}

function openPanelOnApi(api: DockviewApi, id: PanelId): void {
  const existing = api.panels.find((panel) => panel.id === id);
  if (existing) {
    existing.api.setActive();
    return;
  }

  const def = defFor(id);
  if (!def) return;

  api.addPanel({
    id: def.id,
    component: def.component,
    title: def.title,
  });
}

function addDefaultPanels(api: DockviewApi): void {
  const workspace = api.addPanel({
    id: 'workspace',
    component: 'workspace',
    title: 'Workspace',
  });
  api.addPanel({
    id: 'repository_settings',
    component: 'repository_settings',
    title: 'Repository Settings',
    position: { referencePanel: workspace, direction: 'within' },
  });
  const tree = api.addPanel({
    id: 'tree',
    component: 'tree',
    title: 'Capability Tree',
    position: { referencePanel: workspace, direction: 'right' },
  });
  api.addPanel({
    id: 'map',
    component: 'map',
    title: 'Capability Map',
    position: { referencePanel: tree, direction: 'within' },
  });
  api.addPanel({
    id: 'inspector',
    component: 'inspector',
    title: 'Inspector',
    position: { referencePanel: tree, direction: 'right' },
  });
  api.addPanel({
    id: 'git',
    component: 'git',
    title: 'Git / Checkpoints',
    position: { referencePanel: workspace, direction: 'within' },
  });
  api.addPanel({
    id: 'diagnostics',
    component: 'diagnostics',
    title: 'Diagnostics',
    position: { referencePanel: 'inspector', direction: 'within' },
  });
  api.addPanel({
    id: 'import_export',
    component: 'import_export',
    title: 'Import / Export',
    position: { referencePanel: 'workspace', direction: 'within' },
  });
  api.addPanel({
    id: 'audit',
    component: 'audit',
    title: 'Raw Events / Audit',
    position: { referencePanel: 'git', direction: 'within' },
  });
}

export type LayoutRestoreResult = 'saved' | 'default' | 'invalid' | 'unchanged';

interface LayoutState {
  api: DockviewApi | null;
  layoutInitialized: boolean;
  openPanelIds: string[];
  closedPanelIds: string[];
  setApi: (api: DockviewApi) => void;
  syncOpenPanels: () => void;
  markPanelClosed: (id: string) => void;
  markPanelOpen: (id: string) => void;
  openPanel: (id: PanelId) => void;
  closePanel: (id: PanelId) => void;
  initializeLayout: (viewSetup?: ViewSetup | null) => LayoutRestoreResult | null;
  resetLayout: (viewSetup?: ViewSetup | null) => LayoutRestoreResult | null;
  currentViewSetup: () => ViewSetup | null;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  api: null,
  layoutInitialized: false,
  openPanelIds: [],
  closedPanelIds: [],

  setApi: (api) => {
    set({
      api,
      layoutInitialized: false,
      openPanelIds: api.panels.map((panel) => panel.id),
      closedPanelIds: [],
    });
  },

  syncOpenPanels: () => {
    const { api, closedPanelIds } = get();
    const closed = new Set(closedPanelIds);
    set({
      openPanelIds: api ? api.panels.map((panel) => panel.id).filter((id) => !closed.has(id)) : [],
    });
  },

  markPanelClosed: (id) => {
    if (!PANEL_IDS.has(id)) return;
    set((state) => ({
      closedPanelIds: state.closedPanelIds.includes(id)
        ? state.closedPanelIds
        : [...state.closedPanelIds, id],
      openPanelIds: state.openPanelIds.filter((panelId) => panelId !== id),
    }));
  },

  markPanelOpen: (id) => {
    if (!PANEL_IDS.has(id)) return;
    set((state) => ({
      closedPanelIds: state.closedPanelIds.filter((panelId) => panelId !== id),
    }));
    get().syncOpenPanels();
  },

  openPanel: (id) => {
    const { api } = get();
    if (!api) return;
    get().markPanelOpen(id);
    openPanelOnApi(api, id);
    get().syncOpenPanels();
  },

  closePanel: (id) => {
    const { api } = get();
    if (!api) return;
    const existing = api.panels.find((panel) => panel.id === id);
    if (!existing) return;
    get().markPanelClosed(id);
    existing.api.close();
    get().syncOpenPanels();
  },

  initializeLayout: (viewSetup) => {
    const { api, layoutInitialized } = get();
    if (!api) return null;
    if (layoutInitialized) return 'unchanged';
    const result = applyViewSetupOrDefault(api, viewSetup);
    set({ layoutInitialized: true, closedPanelIds: closedPanelIdsForApi(api) });
    get().syncOpenPanels();
    return result;
  },

  resetLayout: (viewSetup) => {
    const { api } = get();
    if (!api) return null;
    const result = applyViewSetupOrDefault(api, viewSetup);
    set({ layoutInitialized: true, closedPanelIds: closedPanelIdsForApi(api) });
    get().syncOpenPanels();
    return result;
  },

  currentViewSetup: () => {
    const { api } = get();
    if (!api) return null;
    return captureViewSetup(api);
  },
}));

export function createInitialLayout(
  api: DockviewApi,
  viewSetup?: ViewSetup | null,
): LayoutRestoreResult {
  const result = applyViewSetupOrDefault(api, viewSetup);
  useLayoutStore.getState().syncOpenPanels();
  return result;
}

export function isPanelOpen(id: PanelId): boolean {
  const api = useLayoutStore.getState().api;
  return api ? panelExists(api, id) : false;
}

export function captureViewSetup(
  api: DockviewApi,
  openPanelIds?: ReadonlySet<string>,
): ViewSetup | null {
  const viewSetup = api.toJSON() as unknown;
  return normalizeViewSetup(
    viewSetup,
    openPanelIds ?? new Set(api.panels.map((panel) => panel.id)),
  );
}

export function applyViewSetupOrDefault(
  api: DockviewApi,
  viewSetup?: ViewSetup | null,
): LayoutRestoreResult {
  if (viewSetup !== undefined && viewSetup !== null) {
    const normalized = normalizeViewSetup(viewSetup);
    if (normalized) {
      try {
        api.fromJSON(normalized as unknown as SerializedDockview);
        return 'saved';
      } catch {
        resetToBuiltInLayout(api);
        return 'invalid';
      }
    }
    resetToBuiltInLayout(api);
    return 'invalid';
  }
  resetToBuiltInLayout(api);
  return 'default';
}

export function isValidViewSetup(viewSetup: unknown): viewSetup is ViewSetup {
  return normalizeViewSetup(viewSetup) !== null;
}

export function normalizeViewSetup(
  viewSetup: unknown,
  openPanelIds?: ReadonlySet<string>,
): ViewSetup | null {
  if (!isRecord(viewSetup) || !isRecord(viewSetup.grid) || !isRecord(viewSetup.panels)) {
    return null;
  }

  const effectiveOpenPanelIds = openPanelIds ?? visiblePanelIdsFromViewSetup(viewSetup);
  const normalizedRoot = normalizeGridNode(viewSetup.grid.root, effectiveOpenPanelIds);
  if (!normalizedRoot) return null;

  const normalizedFloatingGroups = normalizeSerializedGroups(
    viewSetup.floatingGroups,
    effectiveOpenPanelIds,
  );
  if (viewSetup.floatingGroups !== undefined && normalizedFloatingGroups === null) return null;

  const normalizedPopoutGroups = normalizeSerializedGroups(
    viewSetup.popoutGroups,
    effectiveOpenPanelIds,
  );
  if (viewSetup.popoutGroups !== undefined && normalizedPopoutGroups === null) return null;

  const referencedPanelIds = new Set<string>();
  collectPanelIdsFromGrid(normalizedRoot, referencedPanelIds);
  normalizedFloatingGroups?.forEach((group) =>
    collectPanelIdsFromGroup(group.data, referencedPanelIds),
  );
  normalizedPopoutGroups?.forEach((group) =>
    collectPanelIdsFromGroup(group.data, referencedPanelIds),
  );
  if (referencedPanelIds.size === 0) return null;

  const panels: Record<string, unknown> = {};
  for (const panelId of referencedPanelIds) {
    const panel = viewSetup.panels[panelId];
    const normalizedPanel = normalizeSerializedPanel(panelId, panel);
    if (!normalizedPanel) return null;
    panels[panelId] = normalizedPanel;
  }

  const normalizedGrid: Record<string, unknown> = {
    ...viewSetup.grid,
    root: normalizedRoot,
  };
  const normalized: ViewSetup = {
    ...viewSetup,
    grid: normalizedGrid,
    panels,
    visible_panel_ids: orderedPanelIds(referencedPanelIds),
  };
  if (normalizedFloatingGroups && normalizedFloatingGroups.length > 0) {
    normalized.floatingGroups = normalizedFloatingGroups;
  } else {
    delete normalized.floatingGroups;
  }
  if (normalizedPopoutGroups && normalizedPopoutGroups.length > 0) {
    normalized.popoutGroups = normalizedPopoutGroups;
  } else {
    delete normalized.popoutGroups;
  }
  return normalized;
}

function resetToBuiltInLayout(api: DockviewApi): void {
  api.clear();
  addDefaultPanels(api);
}

function closedPanelIdsForApi(api: DockviewApi): string[] {
  const open = new Set(api.panels.map((panel) => panel.id));
  return PANEL_DEFS.map((panel) => panel.id).filter((id) => !open.has(id));
}

function normalizeGridNode(
  node: unknown,
  openPanelIds?: ReadonlySet<string>,
): Record<string, unknown> | null {
  if (!isRecord(node)) return null;
  if (node.type === 'leaf') {
    const groupData = normalizeGroupData(node.data, openPanelIds);
    return groupData ? { ...node, data: groupData } : null;
  }
  if (node.type === 'branch') {
    if (!Array.isArray(node.data)) return null;
    const children = node.data
      .map((child) => normalizeGridNode(child, openPanelIds))
      .filter((child): child is Record<string, unknown> => child !== null);
    if (children.length === 0) return null;
    return { ...node, data: children };
  }
  return null;
}

function normalizeSerializedGroups(
  groups: unknown,
  openPanelIds?: ReadonlySet<string>,
): Array<Record<string, unknown> & { data: Record<string, unknown> }> | null | undefined {
  if (groups === undefined) return undefined;
  if (!Array.isArray(groups)) return null;

  const normalizedGroups: Array<Record<string, unknown> & { data: Record<string, unknown> }> = [];
  for (const group of groups) {
    if (!isRecord(group)) return null;
    const data = normalizeGroupData(group.data, openPanelIds);
    if (data) normalizedGroups.push({ ...group, data });
  }
  return normalizedGroups;
}

function normalizeGroupData(
  data: unknown,
  openPanelIds?: ReadonlySet<string>,
): Record<string, unknown> | null {
  if (!isRecord(data) || typeof data.id !== 'string' || !Array.isArray(data.views)) {
    return null;
  }

  const views = dedupeStrings(data.views).filter(
    (panelId) => PANEL_IDS.has(panelId) && (!openPanelIds || openPanelIds.has(panelId)),
  );
  if (views.length === 0) return null;

  const activeView =
    typeof data.activeView === 'string' && views.includes(data.activeView)
      ? data.activeView
      : views[0];
  return { ...data, views, activeView };
}

function visiblePanelIdsFromViewSetup(viewSetup: Record<string, unknown>): Set<string> | undefined {
  if (!Array.isArray(viewSetup.visible_panel_ids)) return undefined;
  const panelIds = dedupeStrings(viewSetup.visible_panel_ids).filter((panelId) =>
    PANEL_IDS.has(panelId),
  );
  return panelIds.length > 0 ? new Set(panelIds) : undefined;
}

function orderedPanelIds(panelIds: ReadonlySet<string>): string[] {
  return PANEL_DEFS.map((panel) => panel.id).filter((id) => panelIds.has(id));
}

function collectPanelIdsFromGrid(node: Record<string, unknown>, target: Set<string>): void {
  if (node.type === 'leaf') {
    collectPanelIdsFromGroup(node.data, target);
    return;
  }
  if (node.type === 'branch' && Array.isArray(node.data)) {
    for (const child of node.data) {
      if (isRecord(child)) collectPanelIdsFromGrid(child, target);
    }
  }
}

function collectPanelIdsFromGroup(data: unknown, target: Set<string>): void {
  if (!isRecord(data) || !Array.isArray(data.views)) return;
  for (const view of data.views) {
    if (typeof view === 'string') target.add(view);
  }
}

function normalizeSerializedPanel(panelId: string, panel: unknown): Record<string, unknown> | null {
  if (!PANEL_IDS.has(panelId) || !isRecord(panel)) return null;
  const id = panel.id;
  const component = panel.contentComponent;
  const valid =
    id === panelId &&
    typeof id === 'string' &&
    PANEL_IDS.has(id) &&
    typeof component === 'string' &&
    PANEL_COMPONENTS.has(component);
  if (!valid) return null;

  const normalized = { ...panel };
  // Dockview serializes React's default tab component by name, but the app supplies
  // that component at runtime. Persisting the name can make restored layouts brittle.
  delete normalized.tabComponent;
  return normalized;
}

function dedupeStrings(values: unknown[]): string[] {
  const deduped: string[] = [];
  for (const value of values) {
    if (typeof value === 'string' && !deduped.includes(value)) deduped.push(value);
  }
  return deduped;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
