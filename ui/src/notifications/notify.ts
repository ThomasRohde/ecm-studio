import { useAppStore } from '../store/app-store';
import type { AppToast, AppToastUpdate, ToastIntent, ToastKind } from './notification-store';
import { useNotificationStore } from './notification-store';

type NotifyInput = Omit<AppToast, 'id' | 'kind' | 'intent'> & {
  id?: string;
  intent?: AppToast['intent'];
};
type PromiseToastInput = NotifyInput;

interface PromiseToastOptions<T> {
  loading: PromiseToastInput;
  success: PromiseToastInput | ((result: T) => PromiseToastInput);
  error: PromiseToastInput | ((error: unknown) => PromiseToastInput);
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function fallbackIntent(kind: ToastKind): ToastIntent {
  return kind === 'error' ? 'operation.failed' : 'operation.progress';
}

function show(kind: ToastKind, input: NotifyInput): string {
  const record = useNotificationStore.getState().notify({
    ...input,
    kind,
    intent: input.intent ?? fallbackIntent(kind),
  });
  return record.id;
}

function update(id: string, kind: ToastKind, input: PromiseToastInput): void {
  const updatePayload: AppToastUpdate = {
    ...input,
    kind,
    intent: input.intent ?? fallbackIntent(kind),
  };
  useNotificationStore.getState().updateNotification(id, updatePayload);
}

export const notify = {
  show: (toast: AppToast) => useNotificationStore.getState().notify(toast).id,

  success: (input: NotifyInput) => show('success', input),

  info: (input: NotifyInput) => show('info', input),

  warning: (input: NotifyInput) => show('warning', input),

  progress: (input: PromiseToastInput) =>
    show('progress', {
      ...input,
      intent: input.intent ?? 'operation.progress',
    }),

  error: (input: NotifyInput) => {
    const id = show('error', {
      ...input,
      intent: input.intent ?? 'operation.failed',
      persistent: input.persistent ?? true,
    });
    useAppStore.getState().setError(input.body ?? input.title);
    return id;
  },

  promise: async <T>(run: () => Promise<T>, options: PromiseToastOptions<T>): Promise<T> => {
    const id = notify.progress(options.loading);
    try {
      const result = await run();
      const success =
        typeof options.success === 'function' ? options.success(result) : options.success;
      update(id, 'success', success);
      return result;
    } catch (error) {
      const errorToast = typeof options.error === 'function' ? options.error(error) : options.error;
      const body = errorToast.body ?? errorMessage(error);
      update(id, 'error', {
        ...errorToast,
        body,
        intent: errorToast.intent ?? 'operation.failed',
        persistent: errorToast.persistent ?? true,
      });
      useAppStore.getState().setError(body);
      throw error;
    }
  },
};
