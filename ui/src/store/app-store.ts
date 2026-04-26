import { create } from 'zustand';
import type {
  AppInfo,
  AuditEvent,
  BranchIntegrationCandidate,
  Capability,
  Checkpoint,
  Diagnostic,
  GitGraphData,
  GitStatus,
  ReleaseStatus,
  Workspace,
} from '../api/types';

export interface WorkspaceSnapshot {
  workspace: Workspace;
  tree: Capability[];
  diagnostics: Diagnostic[];
  gitStatus: GitStatus;
  gitHistory: Checkpoint[];
  gitGraph: GitGraphData;
  releaseStatus: ReleaseStatus;
  integrationCandidates: BranchIntegrationCandidate[];
  auditEvents: AuditEvent[];
}

interface AppState {
  appInfo: AppInfo | null;
  workspace: Workspace | null;
  tree: Capability[];
  selectedId: string | null;
  selected: Capability | null;
  searchResults: Capability[];
  gitStatus: GitStatus | null;
  gitHistory: Checkpoint[];
  gitGraph: GitGraphData | null;
  releaseStatus: ReleaseStatus | null;
  integrationCandidates: BranchIntegrationCandidate[];
  diagnostics: Diagnostic[];
  auditEvents: AuditEvent[];
  error: string | null;
  setAppInfo: (appInfo: AppInfo | null) => void;
  setWorkspace: (workspace: Workspace | null) => void;
  setTree: (tree: Capability[]) => void;
  setSelected: (capability: Capability | null) => void;
  setGitStatus: (status: GitStatus | null) => void;
  setGitWorkspaceState: (state: {
    gitStatus: GitStatus;
    gitHistory: Checkpoint[];
    gitGraph: GitGraphData;
    releaseStatus: ReleaseStatus;
    integrationCandidates: BranchIntegrationCandidate[];
  }) => void;
  setDiagnostics: (diagnostics: Diagnostic[]) => void;
  setAuditEvents: (events: AuditEvent[]) => void;
  setError: (error: string | null) => void;
  applyWorkspaceSnapshot: (snapshot: WorkspaceSnapshot) => void;
  clearWorkspaceData: () => void;
  reset: () => void;
}

const EMPTY_WORKSPACE_DATA = {
  tree: [],
  selectedId: null,
  selected: null,
  searchResults: [],
  gitStatus: null,
  gitHistory: [],
  gitGraph: null,
  releaseStatus: null,
  integrationCandidates: [],
  diagnostics: [],
  auditEvents: [],
  error: null,
};

function flattenCapabilities(nodes: Capability[]): Capability[] {
  return nodes.flatMap((node) => [node, ...flattenCapabilities(node.children ?? [])]);
}

export const useAppStore = create<AppState>((set) => ({
  appInfo: null,
  workspace: null,
  ...EMPTY_WORKSPACE_DATA,
  setAppInfo: (appInfo) => set({ appInfo }),
  setWorkspace: (workspace) => set((state) => {
    if (!workspace) return { workspace: null, ...EMPTY_WORKSPACE_DATA };
    if (state.workspace?.path === workspace.path) {
      return { workspace, gitStatus: workspace.git ?? state.gitStatus };
    }
    return {
      ...EMPTY_WORKSPACE_DATA,
      workspace,
      gitStatus: workspace.git ?? null,
    };
  }),
  setTree: (tree) => set({ tree }),
  setSelected: (capability) => set({ selected: capability, selectedId: capability?.id ?? null }),
  setGitStatus: (gitStatus) => set({ gitStatus }),
  setGitWorkspaceState: ({
    gitStatus,
    gitHistory,
    gitGraph,
    releaseStatus,
    integrationCandidates,
  }) => set({
    gitStatus,
    gitHistory,
    gitGraph,
    releaseStatus,
    integrationCandidates,
  }),
  setDiagnostics: (diagnostics) => set({ diagnostics }),
  setAuditEvents: (auditEvents) => set({ auditEvents }),
  setError: (error) => set({ error }),
  applyWorkspaceSnapshot: (snapshot) => set((state) => {
    const sameWorkspace = state.workspace?.path === snapshot.workspace.path;
    const selectedId = sameWorkspace ? state.selectedId : null;
    const selected = selectedId
      ? flattenCapabilities(snapshot.tree).find((capability) => capability.id === selectedId) ?? null
      : null;

    return {
      workspace: snapshot.workspace,
      tree: snapshot.tree,
      selected,
      selectedId: selected?.id ?? null,
      searchResults: [],
      gitStatus: snapshot.gitStatus,
      gitHistory: snapshot.gitHistory,
      gitGraph: snapshot.gitGraph,
      releaseStatus: snapshot.releaseStatus,
      integrationCandidates: snapshot.integrationCandidates,
      diagnostics: snapshot.diagnostics,
      auditEvents: snapshot.auditEvents,
      error: null,
    };
  }),
  clearWorkspaceData: () => set({ workspace: null, ...EMPTY_WORKSPACE_DATA }),
  reset: () => set({ appInfo: null, workspace: null, ...EMPTY_WORKSPACE_DATA }),
}));
