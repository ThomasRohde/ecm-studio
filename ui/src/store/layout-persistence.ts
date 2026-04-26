import type { DockviewApi } from 'dockview';
import type { ViewSetup } from '../api/types';
import { captureViewSetup } from './layout-store';

type TimerHandle = ReturnType<typeof setTimeout>;

interface LayoutPersistenceOptions {
  delayMs?: number;
  getInitialized: () => boolean;
  save: (viewSetup: ViewSetup) => Promise<void> | void;
  onError?: (error: unknown) => void;
  setTimeoutFn?: (handler: () => void, timeout: number) => TimerHandle;
  clearTimeoutFn?: (handle: TimerHandle) => void;
}

export interface LayoutPersistenceController {
  schedule: () => void;
  flush: () => Promise<void>;
  dispose: () => void;
}

export function createLayoutPersistence(
  api: DockviewApi,
  options: LayoutPersistenceOptions,
): LayoutPersistenceController {
  const delayMs = options.delayMs ?? 500;
  const setTimer = options.setTimeoutFn ?? ((handler, timeout) => setTimeout(handler, timeout));
  const clearTimer = options.clearTimeoutFn ?? ((handle) => clearTimeout(handle));
  let timer: TimerHandle | null = null;
  let disposed = false;
  let saving = false;
  let pendingAfterSave = false;
  let lastSavedJson: string | null = null;

  async function flush(): Promise<void> {
    if (disposed || !options.getInitialized()) return;
    const viewSetup = captureViewSetup(api);
    if (!viewSetup) return;

    const serialized = JSON.stringify(viewSetup);
    if (serialized === lastSavedJson) return;
    if (saving) {
      pendingAfterSave = true;
      return;
    }

    saving = true;
    try {
      await options.save(viewSetup);
      lastSavedJson = serialized;
    } catch (error) {
      options.onError?.(error);
    } finally {
      saving = false;
      if (pendingAfterSave && !disposed) {
        pendingAfterSave = false;
        schedule();
      }
    }
  }

  function schedule(): void {
    if (disposed || !options.getInitialized()) return;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      void flush();
    }, delayMs);
  }

  return {
    schedule,
    flush,
    dispose: () => {
      disposed = true;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
    },
  };
}
