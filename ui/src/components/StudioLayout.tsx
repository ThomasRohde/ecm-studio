import { useCallback } from 'react';
import { DockviewReact, themeAbyss, themeLight, type DockviewReadyEvent } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import { CapabilityMapPanel } from './CapabilityMapPanel';
import { CapabilityTreePanel, InspectorPanel } from './CapabilityPanels';
import { GroupHeaderActions } from './GroupHeaderActions';
import { AuditPanel, DiagnosticsPanel, GitPanel, ImportExportPanel, WorkspacePanel } from './WorkspacePanels';
import { createInitialLayout, useLayoutStore } from '../store/layout-store';
import { useSettingsStore } from '../store/settings-store';

const components = {
  workspace: WorkspacePanel,
  tree: CapabilityTreePanel,
  map: CapabilityMapPanel,
  inspector: InspectorPanel,
  git: GitPanel,
  import_export: ImportExportPanel,
  diagnostics: DiagnosticsPanel,
  audit: AuditPanel,
};

export function StudioLayout() {
  const setApi = useLayoutStore((state) => state.setApi);
  const syncOpenPanels = useLayoutStore((state) => state.syncOpenPanels);
  const resolvedTheme = useSettingsStore((state) => state.settings.resolved_theme);
  const dockviewTheme = resolvedTheme === 'dark' ? themeAbyss : themeLight;

  const onReady = useCallback((event: DockviewReadyEvent) => {
    setApi(event.api);
    createInitialLayout(event.api);
    event.api.onDidLayoutChange(syncOpenPanels);
    event.api.onDidRemovePanel(syncOpenPanels);
    event.api.onDidAddPanel(syncOpenPanels);
  }, [setApi, syncOpenPanels]);

  return (
    <DockviewReact
      className="dockview"
      theme={dockviewTheme}
      components={components}
      onReady={onReady}
      rightHeaderActionsComponent={GroupHeaderActions}
    />
  );
}
