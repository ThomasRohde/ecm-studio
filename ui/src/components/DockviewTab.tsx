import type { IDockviewPanelHeaderProps } from 'dockview';
import { useLayoutStore } from '../store/layout-store';
import { useSettingsStore } from '../store/settings-store';

function saveCurrentLayoutBaseline() {
  const viewSetup = useLayoutStore.getState().currentViewSetup();
  if (!viewSetup) return;
  void useSettingsStore.getState().setViewSetup(viewSetup);
}

function saveAfterDockviewUpdate() {
  window.setTimeout(saveCurrentLayoutBaseline, 0);
}

export function DockviewTab({ api }: IDockviewPanelHeaderProps) {
  return (
    <div className="dv-default-tab ecm-dock-tab" data-ecms-panel-id={api.id}>
      <div className="dv-default-tab-content">{api.title}</div>
      <button
        aria-label={`Close ${api.title}`}
        className="dv-default-tab-action ecm-dock-tab-close"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          useLayoutStore.getState().markPanelClosed(api.id);
          api.close();
          saveAfterDockviewUpdate();
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        type="button"
      >
        x
      </button>
    </div>
  );
}
