import { FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { useEffect, useState } from 'react';
import { api } from './api/bridge';
import { AppMenu } from './components/AppMenu';
import { GitBadges } from './components/GitBadges';
import { StatusBar } from './components/StatusBar';
import { StudioLayout } from './components/StudioLayout';
import { NotificationCenter, NotificationCenterButton } from './notifications/NotificationCenter';
import { errorMessage, notify } from './notifications/notify';
import { ToastHost } from './notifications/ToastHost';
import { useAppStore } from './store/app-store';
import { applyTheme, useSettingsStore } from './store/settings-store';
import { BlockingTaskDialog } from './tasks/BlockingTaskDialog';
import { hydrateStartupWorkspace } from './workspace/workspace-refresh';

let startupWorkspaceHydrationStarted = false;

export function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const settings = useSettingsStore((state) => state.settings);
  const loadSettings = useSettingsStore((state) => state.load);
  const gitStatus = useAppStore((state) => state.gitStatus);
  const setAppInfo = useAppStore((state) => state.setAppInfo);
  const fluentTheme = settings.resolved_theme === 'dark' ? webDarkTheme : webLightTheme;

  useEffect(() => {
    void api.app
      .info()
      .then(setAppInfo)
      .catch(() => setAppInfo(null));
  }, [setAppInfo]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (startupWorkspaceHydrationStarted) return;
    startupWorkspaceHydrationStarted = true;
    void hydrateStartupWorkspace().catch((error) => {
      notify.error({
        intent: 'operation.failed',
        title: 'Could not load startup workspace',
        body: errorMessage(error),
        source: 'workspace',
        dedupeKey: 'workspace.startup',
        action: { label: 'Open workspace', panelId: 'workspace' },
      });
    });
  }, []);

  useEffect(() => {
    applyTheme(settings.resolved_theme);
  }, [settings.resolved_theme]);

  return (
    <FluentProvider theme={fluentTheme}>
      <main className="app-shell">
        <header className="titlebar">
          <button
            aria-label="Open menu"
            className="burger-button"
            onClick={() => setMenuOpen(true)}
            type="button"
          >
            <span />
            <span />
            <span />
          </button>
          <div className="title-copy">
            <strong>ECM Studio</strong>
            <span>Desktop Git/JSONL capability management</span>
          </div>
          <GitBadges status={gitStatus} compact />
          <NotificationCenterButton />
          <img alt="" aria-hidden="true" className="app-logo" src="./brand/ecm-studio-logo.svg" />
        </header>
        <section className="studio-area">
          <StudioLayout />
        </section>
        <StatusBar />
        <AppMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
        <NotificationCenter />
        <ToastHost />
        <BlockingTaskDialog />
      </main>
    </FluentProvider>
  );
}
