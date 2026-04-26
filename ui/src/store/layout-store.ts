import { create } from 'zustand';
import type { DockviewApi } from 'dockview';

export type PanelGroup = 'Workspace' | 'Model' | 'Operations';
export type PanelId =
  | 'workspace'
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

interface LayoutState {
  api: DockviewApi | null;
  openPanelIds: string[];
  setApi: (api: DockviewApi) => void;
  syncOpenPanels: () => void;
  openPanel: (id: PanelId) => void;
  resetLayout: () => void;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  api: null,
  openPanelIds: [],

  setApi: (api) => {
    set({ api, openPanelIds: api.panels.map((panel) => panel.id) });
  },

  syncOpenPanels: () => {
    const { api } = get();
    set({ openPanelIds: api ? api.panels.map((panel) => panel.id) : [] });
  },

  openPanel: (id) => {
    const { api } = get();
    if (!api) return;
    openPanelOnApi(api, id);
    get().syncOpenPanels();
  },

  resetLayout: () => {
    const { api } = get();
    if (!api) return;
    for (const panel of [...api.panels]) {
      panel.api.close();
    }
    addDefaultPanels(api);
    get().syncOpenPanels();
  },
}));

export function createInitialLayout(api: DockviewApi): void {
  if (api.panels.length === 0) {
    addDefaultPanels(api);
  }
  useLayoutStore.getState().syncOpenPanels();
}

export function isPanelOpen(id: PanelId): boolean {
  const api = useLayoutStore.getState().api;
  return api ? panelExists(api, id) : false;
}
