import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../store/app-store';
import {
  defaultPersistent,
  defaultTtlMs,
  HISTORY_LIMIT,
  notificationTimeoutMs,
  selectToastStack,
  useNotificationStore,
} from './notification-store';
import { notify } from './notify';

beforeEach(() => {
  useNotificationStore.getState().reset();
  useAppStore.getState().setError(null);
  vi.restoreAllMocks();
});

describe('notification store', () => {
  it('maps default durations and persistent notifications', () => {
    expect(defaultTtlMs('success')).toBe(3000);
    expect(defaultTtlMs('info')).toBe(4000);
    expect(defaultTtlMs('warning')).toBe(8000);
    expect(defaultTtlMs('error')).toBe(-1);
    expect(defaultPersistent('error')).toBe(true);
    expect(defaultPersistent('progress')).toBe(true);
    expect(notificationTimeoutMs({ persistent: true, ttlMs: 3000 })).toBe(-1);
    expect(notificationTimeoutMs({ persistent: false, ttlMs: 3000 })).toBe(3000);
  });

  it('dedupes by key and increments repeat count', () => {
    const store = useNotificationStore.getState();
    store.notify({
      kind: 'error',
      intent: 'operation.failed',
      title: 'First failure',
      dedupeKey: 'workspace.index.demo',
    });
    store.notify({
      kind: 'error',
      intent: 'operation.failed',
      title: 'Second failure',
      body: 'The latest message wins.',
      dedupeKey: 'workspace.index.demo',
    });

    const notifications = useNotificationStore.getState().notifications;
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      title: 'Second failure',
      body: 'The latest message wins.',
      repeatCount: 2,
      read: false,
      toastDismissed: false,
    });
  });

  it('caps history at the newest 100 records', () => {
    const now = vi.spyOn(Date, 'now');
    for (let index = 0; index < HISTORY_LIMIT + 1; index += 1) {
      now.mockReturnValue(1000 + index);
      useNotificationStore.getState().notify({
        kind: 'info',
        intent: 'operation.progress',
        title: `Event ${index}`,
      });
    }

    const notifications = useNotificationStore.getState().notifications;
    expect(notifications).toHaveLength(HISTORY_LIMIT);
    expect(notifications[0].title).toBe(`Event ${HISTORY_LIMIT}`);
  });

  it('selects newest two toast records plus overflow summary', () => {
    const now = vi.spyOn(Date, 'now');
    for (let index = 0; index < 5; index += 1) {
      now.mockReturnValue(1000 + index);
      useNotificationStore.getState().notify({
        kind: 'info',
        intent: 'operation.progress',
        title: `Event ${index}`,
      });
    }

    const stack = selectToastStack(useNotificationStore.getState().notifications);
    expect(stack.visible.map((item) => item.title)).toEqual(['Event 4', 'Event 3']);
    expect(stack.overflowCount).toBe(3);
  });

  it('updates promise progress to success', async () => {
    await expect(
      notify.promise(async () => 'current', {
        loading: { title: 'Rebuilding index', source: 'workspace' },
        success: (result) => ({
          title: 'Index rebuilt',
          body: `Index is ${result}.`,
          intent: 'workspace.index.rebuilt',
          source: 'workspace',
        }),
        error: { title: 'Index rebuild failed', source: 'workspace' },
      }),
    ).resolves.toBe('current');

    const [notification] = useNotificationStore.getState().notifications;
    expect(notification).toMatchObject({
      kind: 'success',
      intent: 'workspace.index.rebuilt',
      title: 'Index rebuilt',
      body: 'Index is current.',
      persistent: false,
    });
  });

  it('updates promise progress to persistent error and status summary', async () => {
    await expect(
      notify.promise(
        async () => {
          throw new Error('Index is locked');
        },
        {
          loading: { title: 'Rebuilding index', source: 'workspace' },
          success: {
            title: 'Index rebuilt',
            intent: 'workspace.index.rebuilt',
            source: 'workspace',
          },
          error: {
            title: 'Index rebuild failed',
            intent: 'operation.failed',
            source: 'workspace',
          },
        },
      ),
    ).rejects.toThrow('Index is locked');

    const [notification] = useNotificationStore.getState().notifications;
    expect(notification).toMatchObject({
      kind: 'error',
      intent: 'operation.failed',
      title: 'Index rebuild failed',
      body: 'Index is locked',
      persistent: true,
    });
    expect(useAppStore.getState().error).toBe('Index is locked');
  });
});
