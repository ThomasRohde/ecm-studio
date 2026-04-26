import type { DockviewApi, SerializedDockview } from 'dockview';
import { describe, expect, it } from 'vitest';
import type { ViewSetup } from '../api/types';
import {
  applyViewSetupOrDefault,
  captureViewSetup,
  isValidViewSetup,
  normalizeViewSetup,
} from './layout-store';

describe('layout-store view setup helpers', () => {
  it('validates saved layouts against known panels and components', () => {
    expect(isValidViewSetup(validLayout(['workspace', 'tree']))).toBe(true);
    expect(isValidViewSetup(validLayout(['workspace'], { workspace: 'missing' }))).toBe(false);
    expect(isValidViewSetup({ grid: {}, panels: {} })).toBe(false);
    expect(isValidViewSetup(null)).toBe(false);
  });

  it('restores a valid saved layout', () => {
    const api = new FakeDockviewApi();
    const layout = validLayout(['workspace', 'map']);

    const result = applyViewSetupOrDefault(api.asDockviewApi(), layout);

    expect(result).toBe('saved');
    expect(api.loaded).toEqual(layout);
    expect(api.cleared).toBe(0);
    expect(api.panels.map((panel) => panel.id)).toEqual(['workspace', 'map']);
  });

  it('restores and captures a valid single-group leaf root layout', () => {
    const layout = leafRootLayout(['workspace']);
    const api = new FakeDockviewApi({}, layout);

    const result = applyViewSetupOrDefault(api.asDockviewApi(), layout);

    expect(result).toBe('saved');
    expect(api.loaded).toEqual(layout);
    expect(captureViewSetup(api.asDockviewApi())).toEqual(layout);
  });

  it('falls back to the built-in layout when saved layout validation fails', () => {
    const api = new FakeDockviewApi();

    const result = applyViewSetupOrDefault(api.asDockviewApi(), validLayout(['unknown']));

    expect(result).toBe('invalid');
    expect(api.cleared).toBe(1);
    expect(api.panels.map((panel) => panel.id)).toEqual([
      'workspace',
      'tree',
      'map',
      'inspector',
      'git',
      'diagnostics',
      'import_export',
      'audit',
    ]);
  });

  it('falls back to the built-in layout when Dockview rejects a valid shape', () => {
    const api = new FakeDockviewApi({ throwOnRestore: true });
    const layout = validLayout(['workspace']);

    const result = applyViewSetupOrDefault(api.asDockviewApi(), layout);

    expect(result).toBe('invalid');
    expect(api.cleared).toBe(1);
    expect(api.panels.length).toBeGreaterThan(1);
  });

  it('uses the built-in layout when no saved layout exists', () => {
    const api = new FakeDockviewApi();

    const result = applyViewSetupOrDefault(api.asDockviewApi(), null);

    expect(result).toBe('default');
    expect(api.cleared).toBe(1);
    expect(api.panels[0].id).toBe('workspace');
  });

  it('captures only valid current layouts', () => {
    const validApi = new FakeDockviewApi({}, validLayout(['workspace']));
    const invalidApi = new FakeDockviewApi({}, validLayout(['unknown']));

    expect(captureViewSetup(validApi.asDockviewApi())).toEqual(validLayout(['workspace']));
    expect(captureViewSetup(invalidApi.asDockviewApi())).toBeNull();
  });

  it('preserves nested split layout and group sizes when capturing', () => {
    const layout = nestedLayout();
    const api = new FakeDockviewApi({}, layout);

    expect(captureViewSetup(api.asDockviewApi())).toEqual(layout);
  });

  it('drops stale panels that are not referenced by the grid', () => {
    const layout = validLayout(['workspace'], {}, 'main', ['tree']);

    expect(normalizeViewSetup(layout)).toEqual(validLayout(['workspace']));
  });

  it('captures only panels currently open on the Dockview api', () => {
    const layout = validLayout(['workspace', 'tree']);
    const api = new FakeDockviewApi({}, layout, ['workspace']);

    expect(captureViewSetup(api.asDockviewApi())).toEqual(validLayout(['workspace']));
  });

  it('uses saved visible_panel_ids as the authoritative restore set', () => {
    const layout = validLayout(['workspace', 'tree'], {}, 'main', [], ['workspace']);

    expect(normalizeViewSetup(layout)).toEqual(validLayout(['workspace']));
  });

  it('strips runtime tab component names before saving or restoring', () => {
    const layout = validLayout(['workspace']);
    const panels = layout.panels as Record<string, Record<string, unknown>>;
    panels.workspace.tabComponent = 'props.defaultTabComponent';

    expect(normalizeViewSetup(layout)).toEqual(validLayout(['workspace']));
  });
});

interface FakePanel {
  id: string;
  api: { close: () => void; setActive: () => void };
}

class FakeDockviewApi {
  panels: FakePanel[] = [];
  loaded: unknown = null;
  cleared = 0;

  constructor(
    private readonly restoreOptions: { throwOnRestore?: boolean } = {},
    private readonly currentLayout: ViewSetup = validLayout(['workspace']),
    openPanelIds?: string[],
  ) {
    const panelIds = openPanelIds ?? Object.keys(currentLayout.panels as Record<string, unknown>);
    this.panels = panelIds.map((id) => ({
      id,
      api: { close: () => undefined, setActive: () => undefined },
    }));
  }

  asDockviewApi(): DockviewApi {
    return this as unknown as DockviewApi;
  }

  addPanel(options: { id: string }): FakePanel {
    const panel: FakePanel = {
      id: options.id,
      api: {
        close: () => {
          this.panels = this.panels.filter((item) => item !== panel);
        },
        setActive: () => undefined,
      },
    };
    this.panels.push(panel);
    return panel;
  }

  clear(): void {
    this.cleared += 1;
    this.panels = [];
  }

  fromJSON(layout: SerializedDockview): void {
    if (this.restoreOptions.throwOnRestore) {
      throw new Error('Restore failed');
    }
    this.loaded = layout;
    const panelIds = Object.keys(
      (layout as unknown as ViewSetup).panels as Record<string, unknown>,
    );
    this.panels = panelIds.map((id) => ({
      id,
      api: { close: () => undefined, setActive: () => undefined },
    }));
  }

  toJSON(): SerializedDockview {
    return this.currentLayout as unknown as SerializedDockview;
  }
}

function validLayout(
  panelIds: string[],
  componentOverrides: Record<string, string> = {},
  activeGroup = 'main',
  extraPanelIds: string[] = [],
  visiblePanelIds: string[] = panelIds,
): ViewSetup {
  return {
    activeGroup,
    grid: {
      root: {
        type: 'branch',
        size: 1200,
        data: [
          {
            type: 'leaf',
            size: 1200,
            data: {
              id: activeGroup,
              views: panelIds,
              activeView: panelIds[0],
            },
          },
        ],
      },
      height: 800,
      width: 1200,
      orientation: 'HORIZONTAL',
    },
    panels: Object.fromEntries(
      [...panelIds, ...extraPanelIds].map((id) => [
        id,
        {
          id,
          contentComponent: componentOverrides[id] ?? id,
          title: id,
        },
      ]),
    ),
    visible_panel_ids: visiblePanelIds,
  };
}

function leafRootLayout(panelIds: string[]): ViewSetup {
  return {
    activeGroup: 'main',
    grid: {
      root: {
        type: 'leaf',
        size: 1200,
        data: {
          id: 'main',
          views: panelIds,
          activeView: panelIds[0],
        },
      },
      height: 800,
      width: 1200,
      orientation: 'HORIZONTAL',
    },
    panels: Object.fromEntries(
      panelIds.map((id) => [
        id,
        {
          id,
          contentComponent: id,
          title: id,
        },
      ]),
    ),
    visible_panel_ids: panelIds,
  };
}

function nestedLayout(): ViewSetup {
  return {
    activeGroup: 'right',
    grid: {
      root: {
        type: 'branch',
        size: 1500,
        data: [
          {
            type: 'leaf',
            size: 500,
            data: {
              id: 'left',
              views: ['workspace'],
              activeView: 'workspace',
            },
          },
          {
            type: 'branch',
            size: 1000,
            data: [
              {
                type: 'leaf',
                size: 400,
                data: {
                  id: 'middle',
                  views: ['tree', 'map'],
                  activeView: 'map',
                },
              },
              {
                type: 'leaf',
                size: 600,
                data: {
                  id: 'right',
                  views: ['inspector'],
                  activeView: 'inspector',
                },
              },
            ],
          },
        ],
      },
      height: 900,
      width: 1500,
      orientation: 'HORIZONTAL',
    },
    panels: {
      workspace: { id: 'workspace', contentComponent: 'workspace', title: 'Workspace' },
      tree: { id: 'tree', contentComponent: 'tree', title: 'Capability Tree' },
      map: { id: 'map', contentComponent: 'map', title: 'Capability Map' },
      inspector: { id: 'inspector', contentComponent: 'inspector', title: 'Inspector' },
    },
    visible_panel_ids: ['workspace', 'tree', 'map', 'inspector'],
  };
}
