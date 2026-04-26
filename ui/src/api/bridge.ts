import type {
  AppSettings,
  AuditEvent,
  BranchIntegrationCandidate,
  Capability,
  CapabilityPatch,
  Checkpoint,
  Diagnostic,
  Envelope,
  ExportResult,
  GitGraphCommit,
  GitGraphData,
  GitStatus,
  ImportMode,
  ImportPreview,
  ModelFormat,
  PublishResult,
  ReleaseResult,
  ReleaseStatus,
  ReleaseSummary,
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
  graphCommits: GitGraphCommit[];
  settings: AppSettings;
  git: GitStatus;
  latestRelease: ReleaseSummary | null;
  audit: AuditEvent[];
} = {
  workspace: null,
  capabilities: [],
  checkpoints: [],
  graphCommits: [],
  settings: {
    schema_version: '1.0',
    theme_mode: 'system',
    resolved_theme: prefersDark() ? 'dark' : 'light',
    recent_workspaces: [],
  },
  git: mockGitStatus(),
  latestRelease: null,
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
  if (method === 'dialog_pick_workspace') return 'C:\\Mock\\ECM Workspace' as T;
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
  if (method === 'capabilities_save') {
    const id = String(args[0]);
    const patch = args[1] as Partial<Capability>;
    const parentId = (args[2] as string | null) ?? null;
    const order = args[3] as number | undefined;
    const existing = mockState.capabilities.find((c) => c.id === id);
    if (!existing) throw new Error('VALIDATION_FAILED: Capability not found.');
    const previousParentId = existing.parent_id;
    Object.assign(existing, patch, { updated_at: new Date().toISOString() });
    if (previousParentId !== parentId || order !== undefined) {
      moveMockCapability(existing.id, parentId, order);
    }
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
        summary: `Saved capability "${existing.name}".`,
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
  if (method === 'git_integration_candidates') return mockIntegrationCandidates() as T;
  if (method === 'git_create_branch') {
    const branch = String(args[0] || 'work/new-branch');
    if (!mockState.git.branches.includes(branch)) mockState.git.branches.push(branch);
    const sourceHead = headForBranch(mockState.git.branch);
    if (sourceHead) addBranchRef(branch, sourceHead);
    mockState.git.branch = branch;
    return { branch, current_branch: branch } as T;
  }
  if (method === 'git_switch_branch') {
    mockState.git.branch = String(args[0]);
    return { branch: mockState.git.branch } as T;
  }
  if (method === 'git_merge_branch') {
    const sourceBranch = String(args[0]);
    const sourceHead = headForBranch(sourceBranch);
    if (!sourceHead || isMockAncestor(sourceHead, headForBranch(mockState.git.branch))) {
      throw new Error(`GIT_BRANCH_ALREADY_INTEGRATED: Scenario "${sourceBranch}" is already integrated into the current scenario.`);
    }
    addMockGraphCommit(`Integrate ${sourceBranch}`, [headForBranch(mockState.git.branch), sourceHead].filter(Boolean) as string[]);
    return { merged: true, source_branch: sourceBranch, target_branch: mockState.git.branch } as T;
  }
  if (method === 'git_abort_merge') {
    mockState.git.merge_in_progress = false;
    mockState.git.conflicted_files = [];
    return { aborted: true, merge_in_progress: false } as T;
  }
  if (method === 'git_pull') return { pulled: true, remote: 'origin', branch: mockState.git.branch } as T;
  if (method === 'git_push') return { pushed: true, remote: 'origin', branch: mockState.git.branch } as T;
  if (method === 'git_history') return mockState.checkpoints as T;
  if (method === 'git_graph') return mockGitGraph(Number(args[0] || 50)) as T;
  if (method === 'git_checkpoint') {
    const checkpoint = { id: crypto.randomUUID(), message: String(args[0]), timestamp: new Date().toISOString(), author: 'Mock', skipped: false };
    mockState.checkpoints.unshift(checkpoint);
    addMockGraphCommit(checkpoint.message, [headForBranch(mockState.git.branch)].filter(Boolean) as string[], checkpoint.id);
    return checkpoint as T;
  }
  if (method === 'releases_status') return mockReleaseStatus() as T;
  if (method === 'releases_cut') {
    const version = String(args[0] || '');
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('RELEASE_INVALID_VERSION: Release version must use the form "X.Y.Z".');
    if (!mockState.git.has_remote) throw new Error('RELEASE_REMOTE_MISSING: Configure an origin remote before cutting or publishing releases.');
    const tag = `ecm-v${version}`;
    const checkpoint = await mockCall<Checkpoint>('git_checkpoint', [`Release ${tag}`]);
    mockState.latestRelease = {
      id: crypto.randomUUID(),
      version_label: version,
      tag,
      state: 'released',
      capability_count: mockState.capabilities.length,
      export_paths: [
        `ecm/exports/${tag}/capabilities.jsonl`,
        `ecm/exports/${tag}/capabilities.csv`,
        `ecm/exports/${tag}/capabilities.bundle.json`,
      ],
      released_at: new Date().toISOString(),
      checkpoint_id: checkpoint.id,
    };
    addTagRef(tag, checkpoint.id);
    return {
      version_label: version,
      tag,
      checkpoint_id: checkpoint.id,
      model_version_id: mockState.latestRelease.id,
      export_paths: mockState.latestRelease.export_paths,
      released_at: mockState.latestRelease.released_at,
    } as T;
  }
  if (method === 'releases_publish') {
    const tag = String(args[0]);
    if (!mockState.git.has_remote) throw new Error('RELEASE_REMOTE_MISSING: Configure an origin remote before cutting or publishing releases.');
    if (!mockState.latestRelease || mockState.latestRelease.tag !== tag) throw new Error(`RELEASE_TAG_MISSING: Release tag "${tag}" does not exist.`);
    const publishedAt = new Date().toISOString();
    const url = `https://github.com/mock/ecm/releases/tag/${tag}`;
    mockState.latestRelease = {
      ...mockState.latestRelease,
      published_at: publishedAt,
      github_release_url: url,
      delivery_status: 'success',
    };
    const checkpoint = await mockCall<Checkpoint>('git_checkpoint', [`Record publication ${tag}`]);
    return {
      tag,
      github_release_url: url,
      publish_event_id: crypto.randomUUID(),
      checkpoint_id: checkpoint.id,
      published_at: publishedAt,
      pushed: { pushed: true, remote: 'origin', branch: mockState.git.branch ?? 'main' },
    } as T;
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
  if (method === 'external_open_url') {
    return { opened: true, url: String(args[0] || '') } as T;
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

function mockGitGraph(limit: number): GitGraphData {
  const normalizedLimit = Math.max(1, Math.min(limit, 500));
  const visible = mockState.graphCommits.slice(0, normalizedLimit);
  const visibleHashes = new Set(visible.map((commit) => commit.hash));
  const commits = visible.map((commit) => ({
    ...commit,
    parents: commit.parents.filter((parent) => visibleHashes.has(parent)),
    refs: [...commit.refs],
  }));
  return {
    commits,
    current_branch: mockState.git.branch,
    limit: normalizedLimit,
    truncated: mockState.graphCommits.length > normalizedLimit,
  };
}

function mockIntegrationCandidates(): BranchIntegrationCandidate[] {
  const currentHead = headForBranch(mockState.git.branch);
  return mockState.git.branches
    .filter((branch) => branch !== mockState.git.branch)
    .map((branch) => {
      const sourceHead = headForBranch(branch);
      return {
        name: branch,
        integrable: Boolean(sourceHead && !isMockAncestor(sourceHead, currentHead)),
      };
    });
}

function addMockGraphCommit(subject: string, parents: string[] = [], hash = crypto.randomUUID()) {
  const branch = mockState.git.branch ?? 'main';
  removeBranchRef(branch);
  mockState.graphCommits.unshift({
    hash,
    parents,
    subject,
    body: '',
    author: {
      name: 'Mock',
      email: 'mock@example.local',
      timestamp: Math.floor(Date.now() / 1000),
    },
    refs: [branch],
  });
}

function headForBranch(branch?: string | null): string | null {
  if (!branch) return null;
  return mockState.graphCommits.find((commit) => commit.refs.includes(branch))?.hash ?? null;
}

function isMockAncestor(ancestorHash: string, descendantHash: string | null): boolean {
  if (!descendantHash) return false;
  if (ancestorHash === descendantHash) return true;
  const visited = new Set<string>();
  const pending = [descendantHash];
  while (pending.length) {
    const hash = pending.pop();
    if (!hash || visited.has(hash)) continue;
    if (hash === ancestorHash) return true;
    visited.add(hash);
    const commit = mockState.graphCommits.find((item) => item.hash === hash);
    if (commit) pending.push(...commit.parents);
  }
  return false;
}

function addBranchRef(branch: string, hash: string) {
  const commit = mockState.graphCommits.find((item) => item.hash === hash);
  if (!commit || commit.refs.includes(branch)) return;
  commit.refs.push(branch);
}

function addTagRef(tag: string, hash: string) {
  const commit = mockState.graphCommits.find((item) => item.hash === hash);
  if (!commit) return;
  const ref = `tag: ${tag}`;
  if (!commit.refs.includes(ref)) commit.refs.push(ref);
}

function removeBranchRef(branch: string) {
  for (const commit of mockState.graphCommits) {
    commit.refs = commit.refs.filter((ref) => ref !== branch);
  }
}

function mockReleaseStatus(): ReleaseStatus {
  const noRemote = {
    code: 'RELEASE_REMOTE_MISSING',
    message: 'Configure an origin remote before cutting or publishing releases.',
  };
  const noRelease = {
    code: 'RELEASE_TAG_MISSING',
    message: 'No local release is available to publish.',
  };
  const remote = mockState.git.has_remote
    ? {
        name: 'origin',
        url: 'https://github.com/mock/ecm.git',
        host: 'github.com',
        owner: 'mock',
        repo: 'ecm',
        is_github: true,
      }
    : null;
  const cutBlockers = mockState.git.has_remote ? [] : [noRemote];
  const publishBlockers = [
    ...cutBlockers,
    ...(mockState.latestRelease ? [] : [noRelease]),
  ];
  return {
    can_cut: cutBlockers.length === 0,
    can_publish: publishBlockers.length === 0,
    cut_blockers: cutBlockers,
    publish_blockers: publishBlockers,
    remote,
    github_cli: {
      available: mockState.git.has_remote,
      authenticated: mockState.git.has_remote,
      message: null,
    },
    latest_release: mockState.latestRelease,
  };
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
    pickFolder: () => call<string | null>('dialog_pick_workspace'),
    status: () => call<Workspace>('workspace_status'),
    rebuildIndex: () => call<{ capability_count: number; source_hash: string }>('workspace_rebuild_index'),
  },
  capabilities: {
    listTree: () => call<Capability[]>('capabilities_list_tree'),
    get: (id: string) => call<Capability>('capabilities_get', id),
    create: (input: Partial<Capability>) => call<Capability>('capabilities_create', input),
    update: (id: string, patch: CapabilityPatch) => call<Capability>('capabilities_update', id, patch),
    save: (id: string, patch: CapabilityPatch, parentId: string | null, order?: number) => call<Capability>('capabilities_save', id, patch, parentId, order),
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
    graph: (limit = 50) => call<GitGraphData>('git_graph', limit),
    compare: (from: string, to: string) => call<unknown>('git_compare', from, to),
    listBranches: () => call<string[]>('git_list_branches'),
    integrationCandidates: () => call<BranchIntegrationCandidate[]>('git_integration_candidates'),
    createBranch: (name: string) => call<{ branch: string; current_branch: string | null }>('git_create_branch', name),
    switchBranch: (name: string) => call<{ branch: string; rebuild?: unknown }>('git_switch_branch', name),
    mergeBranch: (sourceBranch: string) => call<{ merged: boolean; source_branch: string; target_branch: string | null }>('git_merge_branch', sourceBranch),
    abortMerge: () => call<{ aborted: boolean; merge_in_progress: boolean }>('git_abort_merge'),
    pull: () => call<{ pulled: boolean; remote: string; branch: string }>('git_pull'),
    push: () => call<{ pushed: boolean; remote: string; branch: string }>('git_push'),
  },
  releases: {
    status: () => call<ReleaseStatus>('releases_status'),
    cut: (version: string, notes?: string) => call<ReleaseResult>('releases_cut', version, notes ?? null),
    publish: (tag: string) => call<PublishResult>('releases_publish', tag),
  },
  diagnostics: {
    run: () => call<Diagnostic[]>('diagnostics_run'),
  },
  audit: {
    recent: (limit = 100) => call<AuditEvent[]>('audit_recent', limit),
  },
  external: {
    openUrl: (url: string) => call<{ opened: boolean; url: string }>('external_open_url', url),
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
