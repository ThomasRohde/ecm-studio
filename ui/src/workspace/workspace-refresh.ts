import { api } from '../api/bridge';
import type { AppSettings } from '../api/types';
import { useAppStore, type WorkspaceSnapshot } from '../store/app-store';
import { useSettingsStore } from '../store/settings-store';
import { blockingTask } from '../tasks/blocking-task-store';
import type { BlockingTaskController, BlockingTaskOptions } from '../tasks/blocking-task-store';

export const WORKSPACE_REFRESH_STEPS = [
  'Refreshing workspace status',
  'Loading capability tree',
  'Running diagnostics',
  'Refreshing Git and release state',
  'Loading audit events',
  'Applying workspace data',
];

type WorkspaceTaskName = 'open' | 'init' | 'rebuild' | 'startup' | 'refresh' | 'importApply';

const TASKS: Record<WorkspaceTaskName, Omit<BlockingTaskOptions, 'details'>> = {
  open: {
    title: 'Opening workspace',
    message: 'Opening the ECM workspace and refreshing all views.',
    kind: 'workspace',
    progressMode: 'manual',
    steps: ['Opening workspace', ...WORKSPACE_REFRESH_STEPS],
  },
  init: {
    title: 'Creating workspace',
    message: 'Creating the ECM workspace and refreshing all views.',
    kind: 'workspace',
    progressMode: 'manual',
    steps: ['Creating workspace', ...WORKSPACE_REFRESH_STEPS],
  },
  rebuild: {
    title: 'Rebuilding index',
    message: 'Rebuilding the SQLite index and refreshing all views.',
    kind: 'workspace',
    progressMode: 'manual',
    steps: ['Rebuilding SQLite index', ...WORKSPACE_REFRESH_STEPS],
  },
  startup: {
    title: 'Opening workspace',
    message: 'Loading the startup workspace and refreshing all views.',
    kind: 'workspace',
    progressMode: 'manual',
    steps: WORKSPACE_REFRESH_STEPS,
  },
  refresh: {
    title: 'Refreshing workspace',
    message: 'Refreshing all workspace views.',
    kind: 'workspace',
    progressMode: 'manual',
    steps: WORKSPACE_REFRESH_STEPS,
  },
  importApply: {
    title: 'Applying import',
    message: 'Applying the import and refreshing all workspace views.',
    kind: 'model',
    progressMode: 'manual',
    steps: ['Applying import', ...WORKSPACE_REFRESH_STEPS],
  },
};

export function workspaceRefreshTaskOptions(
  name: WorkspaceTaskName,
  details?: string,
): BlockingTaskOptions {
  const task = TASKS[name];
  return {
    ...task,
    steps: [...task.steps],
    details,
  };
}

export async function loadWorkspaceSnapshot(
  controller?: BlockingTaskController,
): Promise<{ snapshot: WorkspaceSnapshot; settings: AppSettings }> {
  controller?.setStep('Refreshing workspace status');
  const [workspace, settings] = await Promise.all([
    api.workspace.status(),
    api.settings.get(),
  ]);

  controller?.setStep('Loading capability tree');
  const tree = await api.capabilities.listTree();

  controller?.setStep('Running diagnostics');
  const diagnostics = await api.diagnostics.run();

  controller?.setStep('Refreshing Git and release state');
  const [gitStatus, gitHistory, gitGraph, releaseStatus, integrationCandidates] = await Promise.all([
    api.git.status(),
    api.git.history(),
    api.git.graph(),
    api.releases.status(),
    api.git.integrationCandidates(),
  ]);

  controller?.setStep('Loading audit events');
  const auditEvents = await api.audit.recent();

  return {
    settings,
    snapshot: {
      workspace: { ...workspace, git: gitStatus },
      tree,
      diagnostics,
      gitStatus,
      gitHistory,
      gitGraph,
      releaseStatus,
      integrationCandidates,
      auditEvents,
    },
  };
}

export async function refreshWorkspaceViews(
  controller?: BlockingTaskController,
): Promise<WorkspaceSnapshot> {
  const { snapshot, settings } = await loadWorkspaceSnapshot(controller);
  controller?.setStep('Applying workspace data');
  useSettingsStore.getState().applySettings(settings);
  useAppStore.getState().applyWorkspaceSnapshot(snapshot);
  return snapshot;
}

export async function runWorkspaceRefreshTask<T>(
  operation: (controller: BlockingTaskController) => Promise<T>,
  options: BlockingTaskOptions,
): Promise<{ result: T; snapshot: WorkspaceSnapshot }> {
  return blockingTask.run(async (controller) => {
    const result = await operation(controller);
    const snapshot = await refreshWorkspaceViews(controller);
    return { result, snapshot };
  }, { ...options, progressMode: 'manual' });
}

export async function refreshCurrentWorkspaceWithBlocking(
  options: BlockingTaskOptions = workspaceRefreshTaskOptions('refresh'),
): Promise<WorkspaceSnapshot> {
  return blockingTask.run(
    async (controller) => refreshWorkspaceViews(controller),
    { ...options, progressMode: 'manual' },
  );
}

export async function hydrateStartupWorkspace(): Promise<WorkspaceSnapshot | null> {
  try {
    await api.workspace.status();
  } catch (error) {
    if (isWorkspaceNotOpen(error)) return null;
    throw error;
  }
  return refreshCurrentWorkspaceWithBlocking(workspaceRefreshTaskOptions('startup'));
}

export function workspaceDetails(path: string | null | undefined): string | undefined {
  return path ? `Workspace: ${path}` : undefined;
}

function isWorkspaceNotOpen(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('WORKSPACE_NOT_OPEN:');
}
