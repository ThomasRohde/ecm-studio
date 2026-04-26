import { create } from 'zustand';

export type BlockingTaskKind = 'git' | 'release' | 'model' | 'workspace';

export interface BlockingTaskOptions {
  title: string;
  message: string;
  steps: string[];
  details?: string;
  kind?: BlockingTaskKind;
  stepDelayMs?: number;
  progressMode?: 'timed' | 'manual';
}

export interface BlockingTaskController {
  setStep: (currentStep: string, progress?: number) => void;
}

interface BlockingTaskSnapshot {
  open: boolean;
  title: string;
  message: string;
  currentStep?: string;
  progress?: number;
  details?: string;
  kind?: BlockingTaskKind;
  startedAt?: number;
}

interface BlockingTaskState extends BlockingTaskSnapshot {
  startTask: (options: BlockingTaskOptions, startedAt: number) => void;
  setStep: (currentStep: string | undefined, progress: number | undefined) => void;
  closeTask: () => void;
  reset: () => void;
}

export const BLOCKING_TASK_STEP_DELAY_MS = 900;

const CLOSED_TASK: BlockingTaskSnapshot = {
  open: false,
  title: '',
  message: '',
  currentStep: undefined,
  progress: undefined,
  details: undefined,
  kind: undefined,
  startedAt: undefined,
};

function progressForStep(index: number, total: number): number | undefined {
  if (total <= 0) return undefined;
  return Math.min((index + 1) / (total + 1), 0.92);
}

export const useBlockingTaskStore = create<BlockingTaskState>((set) => ({
  ...CLOSED_TASK,

  startTask: (options, startedAt) => {
    const firstStep = options.steps[0];
    set({
      open: true,
      title: options.title,
      message: options.message,
      currentStep: firstStep,
      progress: progressForStep(0, options.steps.length),
      details: options.details,
      kind: options.kind,
      startedAt,
    });
  },

  setStep: (currentStep, progress) => {
    set((state) => (state.open ? { currentStep, progress } : state));
  },

  closeTask: () => set({ ...CLOSED_TASK }),

  reset: () => set({ ...CLOSED_TASK }),
}));

export const blockingTask = {
  run: async <T>(
    operation: (controller: BlockingTaskController) => Promise<T>,
    options: BlockingTaskOptions,
  ): Promise<T> => {
    const store = useBlockingTaskStore.getState();
    if (store.open) {
      throw new Error('BLOCKING_TASK_ACTIVE: Another operation is already running.');
    }

    const steps = [...options.steps];
    const delayMs = options.stepDelayMs ?? BLOCKING_TASK_STEP_DELAY_MS;
    const progressMode = options.progressMode ?? 'timed';
    let stepIndex = 0;
    let timer: ReturnType<typeof setInterval> | undefined;

    store.startTask({ ...options, steps }, Date.now());

    const controller: BlockingTaskController = {
      setStep: (currentStep, progress) => {
        const index = steps.indexOf(currentStep);
        useBlockingTaskStore
          .getState()
          .setStep(
            currentStep,
            progress ?? progressForStep(index >= 0 ? index : stepIndex, steps.length),
          );
      },
    };

    if (progressMode === 'timed' && steps.length > 1) {
      timer = setInterval(() => {
        stepIndex = Math.min(stepIndex + 1, steps.length - 1);
        useBlockingTaskStore
          .getState()
          .setStep(steps[stepIndex], progressForStep(stepIndex, steps.length));
        if (stepIndex >= steps.length - 1 && timer) {
          clearInterval(timer);
          timer = undefined;
        }
      }, delayMs);
    }

    try {
      return await operation(controller);
    } finally {
      if (timer) clearInterval(timer);
      useBlockingTaskStore.getState().closeTask();
    }
  },
};
