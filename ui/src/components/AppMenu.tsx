import { Button, Text } from '@fluentui/react-components';
import { api } from '../api/bridge';
import type { ThemeMode } from '../api/types';
import { useAppStore } from '../store/app-store';
import { PANEL_DEFS, type PanelGroup, useLayoutStore } from '../store/layout-store';
import { useSettingsStore } from '../store/settings-store';

interface AppMenuProps {
  open: boolean;
  onClose: () => void;
}

const GROUPS: PanelGroup[] = ['Workspace', 'Model', 'Operations'];

export function AppMenu({ open, onClose }: AppMenuProps) {
  const openPanel = useLayoutStore((state) => state.openPanel);
  const resetLayout = useLayoutStore((state) => state.resetLayout);
  const openPanelIds = useLayoutStore((state) => state.openPanelIds);
  const setWorkspace = useAppStore((state) => state.setWorkspace);
  const setDiagnostics = useAppStore((state) => state.setDiagnostics);
  const setError = useAppStore((state) => state.setError);
  const workspace = useAppStore((state) => state.workspace);
  const settings = useSettingsStore((state) => state.settings);
  const setThemeMode = useSettingsStore((state) => state.setThemeMode);

  if (!open) return null;

  async function rebuildIndex() {
    try {
      await api.workspace.rebuildIndex();
      setWorkspace(await api.workspace.status());
      onClose();
    } catch (error) {
      setError(String(error));
    }
  }

  async function runDiagnostics() {
    try {
      setDiagnostics(await api.diagnostics.run());
      openPanel('diagnostics');
      onClose();
    } catch (error) {
      setError(String(error));
    }
  }

  async function chooseTheme(themeMode: ThemeMode) {
    try {
      await setThemeMode(themeMode);
    } catch (error) {
      setError(String(error));
    }
  }

  return (
    <>
      <button
        aria-label="Close menu overlay"
        className="menu-scrim open"
        onClick={onClose}
        type="button"
      />
      <aside className="app-menu open">
        <div className="app-menu-header">
          <div>
            <Text weight="semibold">ECM Studio</Text>
            <Text size={200}>Views, layout, and workspace actions</Text>
          </div>
          <Button appearance="subtle" aria-label="Close menu" onClick={onClose}>
            Close
          </Button>
        </div>

        <section className="menu-section">
          <Text className="menu-section-title">Layout</Text>
          <Button
            appearance="primary"
            onClick={() => {
              resetLayout();
              onClose();
            }}
          >
            Reset default layout
          </Button>
        </section>

        <section className="menu-section">
          <Text className="menu-section-title">Theme</Text>
          <div className="menu-action-grid three">
            {(['system', 'light', 'dark'] as ThemeMode[]).map((themeMode) => (
              <Button
                appearance={settings.theme_mode === themeMode ? 'primary' : 'secondary'}
                key={themeMode}
                onClick={() => void chooseTheme(themeMode)}
              >
                {themeMode === 'system' ? 'System' : themeMode === 'light' ? 'Light' : 'Dark'}
              </Button>
            ))}
          </div>
          <Text size={200}>Resolved theme: {settings.resolved_theme}</Text>
        </section>

        {GROUPS.map((group) => (
          <section className="menu-section" key={group}>
            <Text className="menu-section-title">{group} Views</Text>
            <div className="menu-list">
              {PANEL_DEFS.filter((panel) => panel.group === group).map((panel) => {
                const isOpen = openPanelIds.includes(panel.id);
                return (
                  <button
                    className="menu-view-button"
                    key={panel.id}
                    onClick={() => {
                      openPanel(panel.id);
                      onClose();
                    }}
                    type="button"
                  >
                    <span>
                      <strong>{panel.title}</strong>
                      <small>{panel.description}</small>
                    </span>
                    <em>{isOpen ? 'Open' : 'Closed'}</em>
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        <section className="menu-section">
          <Text className="menu-section-title">Workspace Actions</Text>
          <div className="menu-action-grid">
            <Button disabled={!workspace} onClick={() => void rebuildIndex()}>
              Rebuild SQLite index
            </Button>
            <Button disabled={!workspace} onClick={() => void runDiagnostics()}>
              Run diagnostics
            </Button>
          </div>
        </section>
      </aside>
    </>
  );
}
