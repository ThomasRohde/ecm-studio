import { DockviewReact, type DockviewReadyEvent, themeAbyss, themeLight } from 'dockview';
import { useCallback, useEffect } from 'react';
import 'dockview/dist/styles/dockview.css';
import { errorMessage, notify } from '../notifications/notify';
import { createLayoutPersistence } from '../store/layout-persistence';
import { useLayoutStore } from '../store/layout-store';
import { useSettingsStore } from '../store/settings-store';
import { CapabilityMapPanel } from './CapabilityMapPanel';
import { CapabilityTreePanel, InspectorPanel } from './CapabilityPanels';
import { DockviewTab } from './DockviewTab';
import { GroupHeaderActions } from './GroupHeaderActions';
import {
  AuditPanel,
  DiagnosticsPanel,
  GitPanel,
  ImportExportPanel,
  RepositorySettingsPanel,
  WorkspacePanel,
} from './WorkspacePanels';

const components = {
  workspace: WorkspacePanel,
  repository_settings: RepositorySettingsPanel,
  tree: CapabilityTreePanel,
  map: CapabilityMapPanel,
  inspector: InspectorPanel,
  git: GitPanel,
  import_export: ImportExportPanel,
  diagnostics: DiagnosticsPanel,
  audit: AuditPanel,
};

export function StudioLayout() {
  const api = useLayoutStore((state) => state.api);
  const setApi = useLayoutStore((state) => state.setApi);
  const initializeLayout = useLayoutStore((state) => state.initializeLayout);
  const syncOpenPanels = useLayoutStore((state) => state.syncOpenPanels);
  const markPanelClosed = useLayoutStore((state) => state.markPanelClosed);
  const markPanelOpen = useLayoutStore((state) => state.markPanelOpen);
  const layoutInitialized = useLayoutStore((state) => state.layoutInitialized);
  const settingsLoaded = useSettingsStore((state) => state.loaded);
  const viewSetup = useSettingsStore((state) => state.settings.view_setup);
  const resolvedTheme = useSettingsStore((state) => state.settings.resolved_theme);
  const dockviewTheme = resolvedTheme === 'dark' ? themeAbyss : themeLight;

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      setApi(event.api);
    },
    [setApi],
  );

  useEffect(() => {
    if (!api || !settingsLoaded || layoutInitialized) return;
    const result = initializeLayout(viewSetup);
    if (result === 'invalid') {
      notify.warning({
        title: 'Saved layout could not be restored',
        body: 'The built-in layout was restored instead.',
        source: 'workspace',
        dedupeKey: 'layout.restore.invalid',
      });
    }
  }, [api, initializeLayout, layoutInitialized, settingsLoaded, viewSetup]);

  useEffect(() => {
    if (!api || !layoutInitialized) return undefined;
    const persistence = createLayoutPersistence(api, {
      getInitialized: () => useLayoutStore.getState().layoutInitialized,
      save: (nextViewSetup) => useSettingsStore.getState().setViewSetup(nextViewSetup),
      onError: (error) => {
        notify.error({
          title: 'Could not save layout',
          body: errorMessage(error),
          source: 'workspace',
          dedupeKey: 'layout.autosave.failed',
        });
      },
    });
    const handleLayoutChange = () => {
      syncOpenPanels();
      persistence.schedule();
    };
    const flushAfterDockviewUpdate = () => {
      window.setTimeout(() => {
        syncOpenPanels();
        void persistence.flush();
      }, 0);
    };
    const handleLayoutSettled = () => {
      syncOpenPanels();
      void persistence.flush();
    };
    const handleRemovePanel = (panel: { id: string }) => {
      markPanelClosed(panel.id);
      flushAfterDockviewUpdate();
    };
    const handleAddPanel = (panel: { id: string }) => {
      markPanelOpen(panel.id);
      flushAfterDockviewUpdate();
    };
    const handleBeforeUnload = () => {
      void persistence.flush();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') void persistence.flush();
    };
    const disposables = [
      api.onDidLayoutChange(handleLayoutChange),
      api.onDidRemovePanel(handleRemovePanel),
      api.onDidAddPanel(handleAddPanel),
      api.onDidMovePanel(handleLayoutSettled),
      api.onDidAddGroup(handleLayoutSettled),
      api.onDidRemoveGroup(handleLayoutSettled),
    ];
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      persistence.dispose();
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      for (const disposable of disposables) disposable.dispose();
    };
  }, [api, layoutInitialized, markPanelClosed, markPanelOpen, syncOpenPanels]);

  return (
    <DockviewReact
      className="dockview"
      theme={dockviewTheme}
      components={components}
      defaultTabComponent={DockviewTab}
      onReady={onReady}
      rightHeaderActionsComponent={GroupHeaderActions}
    />
  );
}
