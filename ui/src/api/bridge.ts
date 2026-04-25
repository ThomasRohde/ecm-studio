import type {
  AppSettings,
  AuditEvent,
  Capability,
  CapabilityPatch,
  Checkpoint,
  Diagnostic,
  Envelope,
  ExportResult,
  GitStatus,
  ImportMode,
  ImportPreview,
  ModelFormat,
  SearchResult,
  ThemeMode,
  Workspace,
} from './types';

declare global {
  interface Window {
    pywebview?: {
      api: Record<string, (...args: unknown[]) => Promise<Envelope<unknown>> | Envelope<unknown>>;
    };
  }
}

const mockGitStatus = (): GitStatus => ({
  is_repo: true,
  clean: true,
  changed_files: [],
  untracked_files: [],
  conflicted_files: [],
  branch: 'main',
  branches: ['main'],
  has_remote: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  merge_in_progress: false,
});

const mockState: {
  workspace: Workspace | null;
  capabilities: Capability[];
  checkpoints: Checkpoint[];
  settings: AppSettings;
  git: GitStatus;
  audit: AuditEvent[];
} = {
  workspace: null,
  capabilities: [],
  checkpoints: [],
  settings: {
    schema_version: '1.0',
    theme_mode: 'system',
    resolved_theme: prefersDark() ? 'dark' : 'light',
    recent_workspaces: [],
  },
  git: mockGitStatus(),
  audit: [],
};

async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const pywebviewApi = typeof window === 'undefined' ? undefined : window.pywebview?.api;
  if (!pywebviewApi?.[method]) return mockCall<T>(method, args);
  const result = await pywebviewApi[method](...args);
  if (result.ok) return result.data as T;
  throw new Error(`${result.error.code}: ${result.error.message}`);
}

async function mockCall<T>(method: string, args: unknown[]): Promise<T> {
  if (method === 'settings_get') return mockState.settings as T;
  if (method === 'settings_update') {
    const patch = args[0] as Partial<AppSettings>;
    const themeMode = patch.theme_mode ?? mockState.settings.theme_mode;
    mockState.settings = {
      ...mockState.settings,
      theme_mode: themeMode,
      resolved_theme: resolveMockTheme(themeMode),
    };
    return mockState.settings as T;
  }
  if (method === 'workspace_init') {
    mockState.workspace = {
      path: String(args[0]),
      name: String(args[1] || 'Demo Workspace'),
      initialized: true,
      index_current: true,
      git: mockState.git,
    };
    rememberWorkspace(mockState.workspace.path);
    return mockState.workspace as T;
  }
  if (method === 'workspace_pick_init') return mockCall<T>('workspace_init', ['C:\\Mock\\ECM Workspace', args[0] || 'Demo Workspace']);
  if (method === 'workspace_pick_open') return mockCall<T>('workspace_open', ['C:\\Mock\\ECM Workspace']);
  if (method === 'workspace_status' || method === 'workspace_open') {
    if (!mockState.workspace) {
      mockState.workspace = {
        path: String(args[0] || 'C:\\Mock\\ECM Workspace'),
        name: 'Demo Workspace',
        initialized: true,
        index_current: true,
        git: mockState.git,
      };
      rememberWorkspace(mockState.workspace.path);
    }
    mockState.workspace.git = mockState.git;
    return mockState.workspace as T;
  }
  if (method === 'workspace_rebuild_index') return { capability_count: mockState.capabilities.length, source_hash: 'mock' } as T;
  if (method === 'capabilities_create') {
    const input = args[0] as Partial<Capability>;
    const capability: Capability = {
      _t: 'capability',
      schema_version: '1.0',
      id: crypto.randomUUID(),
      name: input.name || 'New Capability',
      aliases: input.aliases || [],
      description: input.description || '',
      domain: input.domain || '',
      type: 'leaf',
      parent_id: input.parent_id || null,
      order: nextMockOrder(input.parent_id || null),
      lifecycle_status: input.lifecycle_status || 'Draft',
      effective_from: null,
      effective_to: null,
      rationale: '',
      source_references: [],
      tags: input.tags || [],
      steward_id: '',
      steward_department: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      children: [],
    };
    mockState.capabilities.push(capability);
    applyComputedCapabilityTypes();
    mockState.audit.unshift({
      source: 'ecm/capability_versions.jsonl',
      line: mockState.audit.length + 1,
      record: {
        _t: 'capability_version',
        schema_version: '1.0',
        id: crypto.randomUUID(),
        capability_id: capability.id,
        action: 'create',
        summary: `Created capability "${capability.name}".`,
        after: capability,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    return capability as T;
  }
  if (method === 'capabilities_update') {
    const id = String(args[0]);
    const patch = args[1] as Partial<Capability>;
    const existing = mockState.capabilities.find((c) => c.id === id);
    if (!existing) throw new Error('VALIDATION_FAILED: Capability not found.');
    Object.assign(existing, patch, { updated_at: new Date().toISOString() });
    applyComputedCapabilityTypes();
    mockState.audit.unshift({
      source: 'ecm/capability_versions.jsonl',
      line: mockState.audit.length + 1,
      record: {
        _t: 'capability_version',
        schema_version: '1.0',
        id: crypto.randomUUID(),
        capability_id: existing.id,
        action: 'update',
        summary: `Updated capability "${existing.name}".`,
        patch,
        after: existing,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    return existing as T;
  }
  if (method === 'capabilities_move') {
    const existing = mockState.capabilities.find((c) => c.id === args[0]);
    if (!existing) throw new Error('VALIDATION_FAILED: Capability not found.');
    moveMockCapability(existing.id, (args[1] as string | null) ?? null, args[2] as number | undefined);
    applyComputedCapabilityTypes();
    return existing as T;
  }
  if (method === 'capabilities_get') {
    const existing = mockState.capabilities.find((c) => c.id === args[0]);
    if (!existing) throw new Error('VALIDATION_FAILED: Capability not found.');
    return existing as T;
  }
  if (method === 'capabilities_list_tree') return buildTree(mockState.capabilities) as T;
  if (method === 'search_query') {
    const q = String(args[0] || '').toLowerCase();
    return mockState.capabilities.filter((c) => c.name.toLowerCase().includes(q)) as T;
  }
  if (method === 'git_status') return mockState.git as T;
  if (method === 'git_list_branches') return mockState.git.branches as T;
  if (method === 'git_create_branch') {
    const branch = String(args[0] || 'work/new-branch');
    if (!mockState.git.branches.includes(branch)) mockState.git.branches.push(branch);
    mockState.git.branch = branch;
    return { branch, current_branch: branch } as T;
  }
  if (method === 'git_switch_branch') {
    mockState.git.branch = String(args[0]);
    return { branch: mockState.git.branch } as T;
  }
  if (method === 'git_merge_branch') return { merged: true, source_branch: String(args[0]), target_branch: mockState.git.branch } as T;
  if (method === 'git_abort_merge') {
    mockState.git.merge_in_progress = false;
    mockState.git.conflicted_files = [];
    return { aborted: true, merge_in_progress: false } as T;
  }
  if (method === 'git_pull') return { pulled: true, remote: 'origin', branch: mockState.git.branch } as T;
  if (method === 'git_push') return { pushed: true, remote: 'origin', branch: mockState.git.branch } as T;
  if (method === 'git_history') return mockState.checkpoints as T;
  if (method === 'git_checkpoint') {
    const checkpoint = { id: crypto.randomUUID(), message: String(args[0]), timestamp: new Date().toISOString(), author: 'Mock', skipped: false };
    mockState.checkpoints.unshift(checkpoint);
    return checkpoint as T;
  }
  if (method === 'diagnostics_run') return [] as T;
  if (method === 'audit_recent') return mockState.audit.slice(0, Number(args[0] || 100)) as T;
  if (method === 'capabilities_export') return { path: 'mock', count: mockState.capabilities.length } as T;
  if (method === 'models_export') {
    return { format: args[0] as ModelFormat, path: 'C:\\Mock\\exports\\capabilities.jsonl', count: mockState.capabilities.length } as T;
  }
  if (method === 'models_import_preview' || method === 'models_import_apply') {
    const preview: ImportPreview = {
      source_path: String(args[0] || 'C:\\Mock\\imports\\capabilities.jsonl'),
      format: 'jsonl',
      mode: (args[1] as ImportMode) || 'validate_only',
      total: mockState.capabilities.length,
      added: 0,
      updated: 0,
      skipped: 0,
      invalid: 0,
      diagnostics: [],
      applied: method === 'models_import_apply',
      rebuild: { capability_count: mockState.capabilities.length, source_hash: 'mock' },
    };
    return preview as T;
  }
  throw new Error(`Mock method not implemented: ${method}`);
}

function buildTree(flat: Capability[]): Capability[] {
  applyComputedCapabilityTypes();
  const byId = new Map(flat.map((cap) => [cap.id, { ...cap, children: [] as Capability[] }]));
  const roots: Capability[] = [];
  for (const cap of [...byId.values()].sort(compareCapabilities)) {
    if (cap.parent_id && byId.has(cap.parent_id)) byId.get(cap.parent_id)!.children!.push(cap);
    else roots.push(cap);
  }
  return roots;
}

function nextMockOrder(parentId: string | null): number {
  const orders = mockState.capabilities
    .filter((cap) => cap.parent_id === parentId)
    .map((cap) => cap.order);
  return Math.max(-1, ...orders) + 1;
}

function moveMockCapability(id: string, parentId: string | null, order?: number) {
  const existing = mockState.capabilities.find((cap) => cap.id === id);
  if (!existing) return;
  const previousParentId = existing.parent_id;
  const destinationSiblings = orderedMockSiblings(parentId, id);
  const destinationIndex = order === undefined
    ? destinationSiblings.length
    : Math.min(Math.max(0, order), destinationSiblings.length);
  existing.parent_id = parentId;
  existing.order = destinationIndex;
  existing.updated_at = new Date().toISOString();

  if (previousParentId !== parentId) {
    normalizeMockSiblings(orderedMockSiblings(previousParentId, id));
  }
  destinationSiblings.splice(destinationIndex, 0, existing);
  normalizeMockSiblings(destinationSiblings);
}

function orderedMockSiblings(parentId: string | null, excludeId?: string): Capability[] {
  return mockState.capabilities
    .filter((cap) => cap.parent_id === parentId && cap.id !== excludeId)
    .sort(compareCapabilities);
}

function normalizeMockSiblings(siblings: Capability[]) {
  siblings.forEach((capability, index) => {
    capability.order = index;
  });
}

function compareCapabilities(a: Capability, b: Capability): number {
  return a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

function applyComputedCapabilityTypes() {
  const parentIds = new Set(mockState.capabilities.map((cap) => cap.parent_id).filter(Boolean));
  for (const capability of mockState.capabilities) {
    capability.type = parentIds.has(capability.id) ? 'abstract' : 'leaf';
  }
}

export const api = {
  settings: {
    get: () => call<AppSettings>('settings_get'),
    update: (patch: { theme_mode?: ThemeMode }) => call<AppSettings>('settings_update', patch),
  },
  workspace: {
    open: (path?: string) => call<Workspace>('workspace_open', path),
    init: (path: string, name: string) => call<Workspace>('workspace_init', path, name),
    pickOpen: () => call<Workspace | null>('workspace_pick_open'),
    pickInit: (name: string) => call<Workspace | null>('workspace_pick_init', name),
    status: () => call<Workspace>('workspace_status'),
    rebuildIndex: () => call<{ capability_count: number; source_hash: string }>('workspace_rebuild_index'),
  },
  capabilities: {
    listTree: () => call<Capability[]>('capabilities_list_tree'),
    get: (id: string) => call<Capability>('capabilities_get', id),
    create: (input: Partial<Capability>) => call<Capability>('capabilities_create', input),
    update: (id: string, patch: CapabilityPatch) => call<Capability>('capabilities_update', id, patch),
    move: (id: string, parentId: string | null, order?: number) => call<Capability>('capabilities_move', id, parentId, order),
    export: (format: 'csv' | 'json') => call<{ path: string; count: number }>('capabilities_export', format),
  },
  models: {
    importPreview: (sourcePath: string | null, mode: ImportMode) => call<ImportPreview | null>('models_import_preview', sourcePath, mode),
    importApply: (sourcePath: string, mode: ImportMode) => call<ImportPreview>('models_import_apply', sourcePath, mode),
    export: (format: ModelFormat) => call<ExportResult | null>('models_export', format, null),
  },
  search: {
    query: (q: string) => call<SearchResult[]>('search_query', q, null),
  },
  git: {
    status: () => call<GitStatus>('git_status'),
    checkpoint: (message: string) => call<Checkpoint>('git_checkpoint', message),
    history: (limit = 50) => call<Checkpoint[]>('git_history', limit),
    compare: (from: string, to: string) => call<unknown>('git_compare', from, to),
    listBranches: () => call<string[]>('git_list_branches'),
    createBranch: (name: string) => call<{ branch: string; current_branch: string | null }>('git_create_branch', name),
    switchBranch: (name: string) => call<{ branch: string; rebuild?: unknown }>('git_switch_branch', name),
    mergeBranch: (sourceBranch: string) => call<{ merged: boolean; source_branch: string; target_branch: string | null }>('git_merge_branch', sourceBranch),
    abortMerge: () => call<{ aborted: boolean; merge_in_progress: boolean }>('git_abort_merge'),
    pull: () => call<{ pulled: boolean; remote: string; branch: string }>('git_pull'),
    push: () => call<{ pushed: boolean; remote: string; branch: string }>('git_push'),
  },
  diagnostics: {
    run: () => call<Diagnostic[]>('diagnostics_run'),
  },
  audit: {
    recent: (limit = 100) => call<AuditEvent[]>('audit_recent', limit),
  },
};

function resolveMockTheme(themeMode: ThemeMode): 'light' | 'dark' {
  if (themeMode === 'light' || themeMode === 'dark') return themeMode;
  return prefersDark() ? 'dark' : 'light';
}

function rememberWorkspace(path: string) {
  mockState.settings.recent_workspaces = [
    path,
    ...mockState.settings.recent_workspaces.filter((item) => item.toLowerCase() !== path.toLowerCase()),
  ].slice(0, 10);
}

function prefersDark() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}
