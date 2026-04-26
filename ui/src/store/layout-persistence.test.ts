import type { DockviewApi, SerializedDockview } from 'dockview';
import { describe, expect, it } from 'vitest';
import type { ViewSetup } from '../api/types';
import { createLayoutPersistence } from './layout-persistence';

describe('layout persistence', () => {
  it('saves a valid current layout after the debounce fires', async () => {
    let pendingTimer: (() => void) | undefined;
    const saved: ViewSetup[] = [];
    const api = fakeApi(validLayout(['workspace']));
    const persistence = createLayoutPersistence(api, {
      delayMs: 25,
      getInitialized: () => true,
      save: (viewSetup) => {
        saved.push(viewSetup);
      },
      setTimeoutFn: (handler) => {
        pendingTimer = handler;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeoutFn: () => {
        pendingTimer = undefined;
      },
    });

    persistence.schedule();

    expect(saved).toEqual([]);
    if (!pendingTimer) throw new Error('Expected a pending debounce timer.');
    pendingTimer();
    await persistence.flush();

    expect(saved).toEqual([validLayout(['workspace'])]);
  });

  it('does not save before layout initialization completes', async () => {
    let initialized = false;
    const saved: ViewSetup[] = [];
    const api = fakeApi(validLayout(['workspace']));
    const persistence = createLayoutPersistence(api, {
      getInitialized: () => initialized,
      save: (viewSetup) => {
        saved.push(viewSetup);
      },
    });

    persistence.schedule();
    await persistence.flush();
    initialized = true;
    await persistence.flush();

    expect(saved).toEqual([validLayout(['workspace'])]);
  });

  it('ignores invalid current layouts', async () => {
    const saved: ViewSetup[] = [];
    const api = fakeApi({
      grid: {},
      panels: { missing: { id: 'missing', contentComponent: 'missing' } },
    });
    const persistence = createLayoutPersistence(api, {
      getInitialized: () => true,
      save: (viewSetup) => {
        saved.push(viewSetup);
      },
    });

    await persistence.flush();

    expect(saved).toEqual([]);
  });

  it('coalesces duplicate saves for the same layout', async () => {
    const saved: ViewSetup[] = [];
    const api = fakeApi(validLayout(['workspace']));
    const persistence = createLayoutPersistence(api, {
      getInitialized: () => true,
      save: (viewSetup) => {
        saved.push(viewSetup);
      },
    });

    await persistence.flush();
    await persistence.flush();

    expect(saved).toEqual([validLayout(['workspace'])]);
  });

  it('saves the full Dockview layout returned by toJSON', async () => {
    const saved: ViewSetup[] = [];
    const layout = nestedLayout();
    const api = fakeApi(layout);
    const persistence = createLayoutPersistence(api, {
      getInitialized: () => true,
      save: (viewSetup) => {
        saved.push(viewSetup);
      },
    });

    await persistence.flush();

    expect(saved).toEqual([layout]);
  });
});

function fakeApi(layout: ViewSetup): DockviewApi {
  return {
    panels: Object.keys(layout.panels as Record<string, unknown>).map((id) => ({ id })),
    toJSON: () => layout as unknown as SerializedDockview,
  } as unknown as DockviewApi;
}

function validLayout(panelIds: string[]): ViewSetup {
  return {
    activeGroup: 'main',
    grid: {
      root: {
        type: 'branch',
        size: 1200,
        data: [
          {
            type: 'leaf',
            size: 1200,
            data: {
              id: 'main',
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
