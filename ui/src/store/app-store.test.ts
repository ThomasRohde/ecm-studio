import { beforeEach, describe, expect, it } from 'vitest';
import type {
  BranchIntegrationCandidate,
  Capability,
  Checkpoint,
  Diagnostic,
  GitGraphData,
  GitStatus,
  ReleaseStatus,
  Workspace,
} from '../api/types';
import { useAppStore, type WorkspaceSnapshot } from './app-store';

beforeEach(() => {
  useAppStore.getState().reset();
});

describe('app store workspace snapshots', () => {
  it('applies complete workspace view state', () => {
    const snapshot = workspaceSnapshot('C:/work/a', [capability('cap-a', 'Payments')]);

    useAppStore.getState().applyWorkspaceSnapshot(snapshot);
    const state = useAppStore.getState();

    expect(state.workspace?.path).toBe('C:/work/a');
    expect(state.tree[0].name).toBe('Payments');
    expect(state.gitStatus?.branch).toBe('main');
    expect(state.gitHistory).toHaveLength(1);
    expect(state.gitGraph?.current_branch).toBe('main');
    expect(state.releaseStatus?.latest_release?.tag).toBe('ecm-v1.0.0');
    expect(state.integrationCandidates).toContainEqual({ name: 'work/demo', integrable: true });
    expect(state.diagnostics).toContainEqual({
      code: 'INDEX_STALE',
      message: 'SQLite projection is missing or stale.',
      severity: 'warning',
    });
    expect(state.auditEvents).toHaveLength(1);
  });

  it('preserves selected capability when refreshing the same workspace', () => {
    const original = capability('cap-a', 'Payments');
    const updated = capability('cap-a', 'Payments Updated');
    useAppStore.getState().applyWorkspaceSnapshot(workspaceSnapshot('C:/work/a', [original]));
    useAppStore.getState().setSelected(original);

    useAppStore.getState().applyWorkspaceSnapshot(workspaceSnapshot('C:/work/a', [updated]));

    expect(useAppStore.getState().selected?.name).toBe('Payments Updated');
    expect(useAppStore.getState().selectedId).toBe('cap-a');
  });

  it('clears stale selected capability when the workspace path changes', () => {
    const selected = capability('cap-a', 'Payments');
    useAppStore.getState().applyWorkspaceSnapshot(workspaceSnapshot('C:/work/a', [selected]));
    useAppStore.getState().setSelected(selected);

    useAppStore.getState().applyWorkspaceSnapshot(workspaceSnapshot('C:/work/b', [
      capability('cap-a', 'Same ID In Different Workspace'),
    ]));

    expect(useAppStore.getState().workspace?.path).toBe('C:/work/b');
    expect(useAppStore.getState().selected).toBeNull();
    expect(useAppStore.getState().selectedId).toBeNull();
  });
});

function workspaceSnapshot(path: string, tree: Capability[]): WorkspaceSnapshot {
  return {
    workspace: workspace(path),
    tree,
    diagnostics: diagnostics(),
    gitStatus: gitStatus(),
    gitHistory: history(),
    gitGraph: graph(),
    releaseStatus: releaseStatus(),
    integrationCandidates: integrationCandidates(),
    auditEvents: [{
      source: 'ecm/capability_versions.jsonl',
      line: 1,
      record: { id: 'event-1', action: 'create', summary: 'Created capability.' },
    }],
  };
}

function workspace(path: string): Workspace {
  return {
    path,
    name: 'Demo',
    initialized: true,
    index_current: true,
    git: gitStatus(),
  };
}

function capability(id: string, name: string): Capability {
  return {
    _t: 'capability',
    schema_version: '1.0',
    id,
    name,
    aliases: [],
    description: '',
    domain: '',
    type: 'leaf',
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
    created_at: '2026-04-26T00:00:00Z',
    updated_at: '2026-04-26T00:00:00Z',
    children: [],
  };
}

function gitStatus(): GitStatus {
  return {
    is_repo: true,
    clean: true,
    changed_files: [],
    untracked_files: [],
    conflicted_files: [],
    branch: 'main',
    branches: ['main', 'work/demo'],
    has_remote: true,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    merge_in_progress: false,
  };
}

function diagnostics(): Diagnostic[] {
  return [{
    code: 'INDEX_STALE',
    message: 'SQLite projection is missing or stale.',
    severity: 'warning',
  }];
}

function history(): Checkpoint[] {
  return [{
    id: 'checkpoint-1',
    message: 'Initial',
    timestamp: '2026-04-26T00:00:00Z',
    author: 'Test',
    skipped: false,
  }];
}

function graph(): GitGraphData {
  return {
    commits: [],
    current_branch: 'main',
    limit: 50,
    truncated: false,
  };
}

function releaseStatus(): ReleaseStatus {
  return {
    can_cut: true,
    can_publish: true,
    cut_blockers: [],
    publish_blockers: [],
    remote: {
      name: 'origin',
      url: 'https://github.com/acme/ecm.git',
      host: 'github.com',
      owner: 'acme',
      repo: 'ecm',
      is_github: true,
    },
    github_cli: { available: true, authenticated: true },
    latest_release: {
      id: 'release-1',
      version_label: '1.0.0',
      tag: 'ecm-v1.0.0',
      state: 'released',
      capability_count: 1,
      export_paths: [],
      released_at: '2026-04-26T00:00:00Z',
    },
  };
}

function integrationCandidates(): BranchIntegrationCandidate[] {
  return [{ name: 'work/demo', integrable: true }];
}
