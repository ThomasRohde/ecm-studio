import { beforeEach, describe, expect, it } from 'vitest';
import { api } from '../api/bridge';
import type { Capability } from '../api/types';
import { useAppStore } from '../store/app-store';
import { useBlockingTaskStore } from '../tasks/blocking-task-store';
import {
  refreshCurrentWorkspaceWithBlocking,
  runWorkspaceRefreshTask,
  workspaceRefreshTaskOptions,
} from './workspace-refresh';

beforeEach(() => {
  (globalThis as unknown as { window: unknown }).window = {};
  useAppStore.getState().reset();
  useBlockingTaskStore.getState().reset();
});

describe('workspace refresh workflow', () => {
  it('runs init through the blocking snapshot workflow and updates global workspace state', async () => {
    const suffix = String(Date.now());
    const path = `C:/tmp/ecm-refresh-${suffix}`;

    const { snapshot } = await runWorkspaceRefreshTask(
      async () => api.workspace.init(path, `Refresh ${suffix}`),
      workspaceRefreshTaskOptions('init', `Workspace: ${path}`),
    );

    const state = useAppStore.getState();
    expect(snapshot.workspace.path).toBe(path);
    expect(state.workspace?.name).toBe(`Refresh ${suffix}`);
    expect(state.gitStatus?.branch).toBe('main');
    expect(state.gitGraph).not.toBeNull();
    expect(state.releaseStatus).not.toBeNull();
    expect(Array.isArray(state.integrationCandidates)).toBe(true);
    expect(Array.isArray(state.auditEvents)).toBe(true);
  });

  it('refreshes model, diagnostics, Git, release, and audit data together', async () => {
    const suffix = String(Date.now());
    await api.workspace.init(`C:/tmp/ecm-refresh-data-${suffix}`, `Data ${suffix}`);
    const created = await api.capabilities.create({ name: `Capability ${suffix}` });

    await refreshCurrentWorkspaceWithBlocking(workspaceRefreshTaskOptions('refresh'));

    const state = useAppStore.getState();
    expect(flatten(state.tree).map((capability) => capability.id)).toContain(created.id);
    expect(state.diagnostics).toEqual([]);
    expect(state.gitStatus?.branch).toBe('main');
    expect(state.releaseStatus?.publish_blockers.length).toBeGreaterThanOrEqual(1);
    expect(state.auditEvents.some((event) => event.record?.capability_id === created.id)).toBe(
      true,
    );
  });
});

function flatten(nodes: Capability[]): Capability[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}
