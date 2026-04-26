import { create } from 'zustand';
import type { PanelId } from '../store/layout-store';

export type ToastKind = 'success' | 'info' | 'warning' | 'error' | 'progress';

export type ToastIntent =
  | 'workspace.opened'
  | 'workspace.created'
  | 'workspace.index.rebuilt'
  | 'capability.created'
  | 'capability.updated'
  | 'capability.moved'
  | 'import.validated'
  | 'import.applied'
  | 'diagnostics.completed'
  | 'git.checkpoint.created'
  | 'git.branch.created'
  | 'git.branch.switched'
  | 'git.pull.completed'
  | 'git.merge.completed'
  | 'git.merge.aborted'
  | 'release.cut'
  | 'release.published'
  | 'release.url.opened'
  | 'model.exported'
  | 'operation.progress'
  | 'operation.failed';

export type ToastSource =
  | 'workspace'
  | 'model'
  | 'git'
  | 'release'
  | 'diagnostics'
  | 'import';

export type NotificationAction =
  | {
      label: string;
      panelId: PanelId;
    }
  | {
      label: string;
      run: () => void;
    };

export interface AppToast {
  id?: string;
  kind: ToastKind;
  intent: ToastIntent;
  title: string;
  body?: string;
  dedupeKey?: string;
  ttlMs?: number;
  persistent?: boolean;
  source?: ToastSource;
  action?: NotificationAction;
}

export type AppToastUpdate = Partial<Omit<AppToast, 'id'>> & {
  kind: ToastKind;
  intent: ToastIntent;
  title: string;
};

export interface NotificationRecord {
  id: string;
  kind: ToastKind;
  intent: ToastIntent;
  title: string;
  body?: string;
  dedupeKey?: string;
  ttlMs: number;
  persistent: boolean;
  source?: ToastSource;
  action?: NotificationAction;
  createdAt: number;
  updatedAt: number;
  read: boolean;
  dismissed: boolean;
  toastDismissed: boolean;
  repeatCount: number;
}

export interface ToastStackSelection {
  visible: NotificationRecord[];
  overflowCount: number;
}

export const HISTORY_LIMIT = 100;

let idCounter = 0;

function notificationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `notification-${Date.now()}-${idCounter++}`;
}

export function defaultPersistent(kind: ToastKind): boolean {
  return kind === 'error' || kind === 'progress';
}

export function defaultTtlMs(kind: ToastKind): number {
  if (kind === 'success') return 3000;
  if (kind === 'info') return 4000;
  if (kind === 'warning') return 8000;
  return -1;
}

export function notificationTimeoutMs(notification: Pick<NotificationRecord, 'persistent' | 'ttlMs'>): number {
  return notification.persistent ? -1 : notification.ttlMs;
}

export function selectToastStack(notifications: NotificationRecord[]): ToastStackSelection {
  const active = notifications
    .filter((notification) => !notification.dismissed && !notification.toastDismissed)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (active.length <= 3) {
    return { visible: active, overflowCount: 0 };
  }

  return {
    visible: active.slice(0, 2),
    overflowCount: active.length - 2,
  };
}

function normalizeToast(toast: AppToast, now: number, existing?: NotificationRecord): NotificationRecord {
  const kind = toast.kind;
  return {
    id: existing?.id ?? toast.id ?? notificationId(),
    kind,
    intent: toast.intent,
    title: toast.title,
    body: toast.body,
    dedupeKey: toast.dedupeKey,
    ttlMs: toast.ttlMs ?? defaultTtlMs(kind),
    persistent: toast.persistent ?? defaultPersistent(kind),
    source: toast.source,
    action: toast.action,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    read: false,
    dismissed: false,
    toastDismissed: false,
    repeatCount: existing ? existing.repeatCount + 1 : 1,
  };
}

function normalizeUpdate(update: AppToastUpdate, existing: NotificationRecord, now: number): NotificationRecord {
  const kind = update.kind;
  return {
    ...existing,
    kind,
    intent: update.intent,
    title: update.title,
    body: update.body,
    dedupeKey: update.dedupeKey ?? existing.dedupeKey,
    ttlMs: update.ttlMs ?? defaultTtlMs(kind),
    persistent: update.persistent ?? defaultPersistent(kind),
    source: update.source ?? existing.source,
    action: update.action,
    updatedAt: now,
    read: false,
    dismissed: false,
    toastDismissed: false,
  };
}

interface NotificationState {
  notifications: NotificationRecord[];
  centerOpen: boolean;
  notify: (toast: AppToast) => NotificationRecord;
  updateNotification: (id: string, update: AppToastUpdate) => void;
  dismissNotification: (id: string) => void;
  markToastDismissed: (id: string) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearRead: () => void;
  setCenterOpen: (open: boolean) => void;
  reset: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  centerOpen: false,

  notify: (toast) => {
    const now = Date.now();
    let nextRecord: NotificationRecord | undefined;

    set((state) => {
      const existing = toast.dedupeKey
        ? state.notifications.find((notification) => notification.dedupeKey === toast.dedupeKey)
        : undefined;
      nextRecord = normalizeToast(toast, now, existing);
      const notifications = existing
        ? state.notifications.map((notification) => (
            notification.id === existing.id ? nextRecord as NotificationRecord : notification
          ))
        : [nextRecord, ...state.notifications];
      return { notifications: notifications.slice(0, HISTORY_LIMIT) };
    });

    return nextRecord as NotificationRecord;
  },

  updateNotification: (id, update) => {
    const now = Date.now();
    set((state) => ({
      notifications: state.notifications.map((notification) => (
        notification.id === id ? normalizeUpdate(update, notification, now) : notification
      )),
    }));
  },

  dismissNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.map((notification) => (
        notification.id === id
          ? { ...notification, dismissed: true, toastDismissed: true, read: true }
          : notification
      )),
    }));
  },

  markToastDismissed: (id) => {
    set((state) => ({
      notifications: state.notifications.map((notification) => (
        notification.id === id ? { ...notification, toastDismissed: true } : notification
      )),
    }));
  },

  markRead: (id) => {
    set((state) => ({
      notifications: state.notifications.map((notification) => (
        notification.id === id ? { ...notification, read: true } : notification
      )),
    }));
  },

  markAllRead: () => {
    set((state) => ({
      notifications: state.notifications.map((notification) => ({ ...notification, read: true })),
    }));
  },

  clearRead: () => {
    set((state) => ({
      notifications: state.notifications.filter((notification) => !notification.read),
    }));
  },

  setCenterOpen: (centerOpen) => set({ centerOpen }),

  reset: () => set({ notifications: [], centerOpen: false }),
}));
