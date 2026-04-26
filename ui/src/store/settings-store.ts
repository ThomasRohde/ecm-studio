import { create } from 'zustand';
import { api } from '../api/bridge';
import type { AppSettings, ResolvedTheme, ThemeMode, ViewSetup } from '../api/types';

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  load: () => Promise<void>;
  setThemeMode: (themeMode: ThemeMode) => Promise<void>;
  setViewSetup: (viewSetup: ViewSetup | null) => Promise<void>;
  applySettings: (settings: AppSettings) => void;
}

const defaultSettings: AppSettings = {
  schema_version: '1.0',
  theme_mode: 'system',
  resolved_theme: prefersDark() ? 'dark' : 'light',
  recent_workspaces: [],
  view_setup: null,
};

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: defaultSettings,
  loaded: false,

  load: async () => {
    const settings = await api.settings.get();
    applyTheme(settings.resolved_theme);
    set({ settings, loaded: true });
  },

  setThemeMode: async (themeMode) => {
    const settings = await api.settings.update({ theme_mode: themeMode });
    applyTheme(settings.resolved_theme);
    set({ settings, loaded: true });
  },

  setViewSetup: async (viewSetup) => {
    const settings = await api.settings.update({ view_setup: viewSetup });
    applyTheme(settings.resolved_theme);
    set({ settings, loaded: true });
  },

  applySettings: (settings) => {
    applyTheme(settings.resolved_theme);
    set({ settings, loaded: true });
  },
}));

export function applyTheme(resolvedTheme: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = resolvedTheme;
  document.body.dataset.theme = resolvedTheme;
}

function prefersDark() {
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
  );
}
