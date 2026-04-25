import { create } from 'zustand';
import type { Capability, Diagnostic, GitStatus, Workspace } from '../api/types';

interface AppState {
  workspace: Workspace | null;
  tree: Capability[];
  selectedId: string | null;
  selected: Capability | null;
  searchResults: Capability[];
  gitStatus: GitStatus | null;
  diagnostics: Diagnostic[];
  error: string | null;
  setWorkspace: (workspace: Workspace | null) => void;
  setTree: (tree: Capability[]) => void;
  setSelected: (capability: Capability | null) => void;
  setGitStatus: (status: GitStatus | null) => void;
  setDiagnostics: (diagnostics: Diagnostic[]) => void;
  setError: (error: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  workspace: null,
  tree: [],
  selectedId: null,
  selected: null,
  searchResults: [],
  gitStatus: null,
  diagnostics: [],
  error: null,
  setWorkspace: (workspace) => set({ workspace, gitStatus: workspace?.git ?? null }),
  setTree: (tree) => set({ tree }),
  setSelected: (capability) => set({ selected: capability, selectedId: capability?.id ?? null }),
  setGitStatus: (gitStatus) => set({ gitStatus }),
  setDiagnostics: (diagnostics) => set({ diagnostics }),
  setError: (error) => set({ error }),
}));
