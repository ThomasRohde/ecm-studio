import { useEffect, useState } from 'react';
import { FluentProvider, webDarkTheme, webLightTheme } from '@fluentui/react-components';
import { StudioLayout } from './components/StudioLayout';
import { StatusBar } from './components/StatusBar';
import { AppMenu } from './components/AppMenu';
import { GitBadges } from './components/GitBadges';
import { useAppStore } from './store/app-store';
import { applyTheme, useSettingsStore } from './store/settings-store';

export function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const settings = useSettingsStore((state) => state.settings);
  const loadSettings = useSettingsStore((state) => state.load);
  const gitStatus = useAppStore((state) => state.gitStatus);
  const fluentTheme = settings.resolved_theme === 'dark' ? webDarkTheme : webLightTheme;

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

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
          <img alt="" aria-hidden="true" className="app-logo" src="./brand/ecm-studio-logo.svg" />
        </header>
        <section className="studio-area"><StudioLayout /></section>
        <StatusBar />
        <AppMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
      </main>
    </FluentProvider>
  );
}
