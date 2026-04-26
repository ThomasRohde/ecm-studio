import { create } from 'zustand';
import { api } from '../api/bridge';
import type { AppSettings, ResolvedTheme, ThemeMode } from '../api/types';

interface SettingsState {
  settings: AppSettings;
  load: () => Promise<void>;
  setThemeMode: (themeMode: ThemeMode) => Promise<void>;
  applySettings: (settings: AppSettings) => void;
}

const defaultSettings: AppSettings = {
  schema_version: '1.0',
  theme_mode: 'system',
  resolved_theme: prefersDark() ? 'dark' : 'light',
  recent_workspaces: [],
};

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: defaultSettings,

  load: async () => {
    const settings = await api.settings.get();
    applyTheme(settings.resolved_theme);
    set({ settings });
  },

  setThemeMode: async (themeMode) => {
    const settings = await api.settings.update({ theme_mode: themeMode });
    applyTheme(settings.resolved_theme);
    set({ settings });
  },

  applySettings: (settings) => {
    applyTheme(settings.resolved_theme);
    set({ settings });
  },
}));

export function applyTheme(resolvedTheme: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = resolvedTheme;
  document.body.dataset.theme = resolvedTheme;
}

function prefersDark() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}
