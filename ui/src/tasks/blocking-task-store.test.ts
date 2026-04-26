import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blockingTask, useBlockingTaskStore } from './blocking-task-store';

beforeEach(() => {
  useBlockingTaskStore.getState().reset();
  vi.useRealTimers();
});

describe('blocking task service', () => {
  it('opens with initial task state', async () => {
    let resolveTask: (value: string) => void = () => {};
    const promise = blockingTask.run(
      () =>
        new Promise<string>((resolve) => {
          resolveTask = resolve;
        }),
      {
        title: 'Creating checkpoint',
        message: 'Saving changes.',
        steps: ['Validating Git state', 'Running Git operation'],
        details: 'Branch: main',
        kind: 'git',
      },
    );

    expect(useBlockingTaskStore.getState()).toMatchObject({
      open: true,
      title: 'Creating checkpoint',
      message: 'Saving changes.',
      currentStep: 'Validating Git state',
      details: 'Branch: main',
      kind: 'git',
    });

    resolveTask('done');
    await expect(promise).resolves.toBe('done');
  });

  it('advances through client-defined steps', async () => {
    vi.useFakeTimers();
    let resolveTask: (value: string) => void = () => {};
    const promise = blockingTask.run(
      () =>
        new Promise<string>((resolve) => {
          resolveTask = resolve;
        }),
      {
        title: 'Cutting release',
        message: 'Creating release.',
        steps: [
          'Validating release inputs',
          'Checking release blockers',
          'Refreshing Git and release state',
        ],
        kind: 'release',
        stepDelayMs: 50,
      },
    );

    expect(useBlockingTaskStore.getState().currentStep).toBe('Validating release inputs');

    await vi.advanceTimersByTimeAsync(50);
    expect(useBlockingTaskStore.getState()).toMatchObject({
      currentStep: 'Checking release blockers',
      progress: 0.5,
    });

    await vi.advanceTimersByTimeAsync(50);
    expect(useBlockingTaskStore.getState()).toMatchObject({
      currentStep: 'Refreshing Git and release state',
      progress: 0.75,
    });

    resolveTask('released');
    await expect(promise).resolves.toBe('released');
    vi.useRealTimers();
  });

  it('lets manual operations report actual progress steps', async () => {
    let continueTask: () => void = () => {};
    const promise = blockingTask.run(
      async (controller) => {
        controller.setStep('Loading capability tree');
        await new Promise<void>((resolve) => {
          continueTask = resolve;
        });
        controller.setStep('Running diagnostics');
        return 'refreshed';
      },
      {
        title: 'Opening workspace',
        message: 'Refreshing views.',
        steps: ['Opening workspace', 'Loading capability tree', 'Running diagnostics'],
        progressMode: 'manual',
      },
    );

    await Promise.resolve();
    expect(useBlockingTaskStore.getState()).toMatchObject({
      currentStep: 'Loading capability tree',
      progress: 0.5,
    });

    continueTask();
    await expect(promise).resolves.toBe('refreshed');
    expect(useBlockingTaskStore.getState().open).toBe(false);
  });

  it('closes after success', async () => {
    await expect(
      blockingTask.run(async () => 'ok', {
        title: 'Receiving updates',
        message: 'Pulling remote updates.',
        steps: ['Validating Git state'],
      }),
    ).resolves.toBe('ok');

    expect(useBlockingTaskStore.getState().open).toBe(false);
  });

  it('closes after error and rethrows', async () => {
    await expect(
      blockingTask.run(
        async () => {
          throw new Error('Pull failed');
        },
        {
          title: 'Receiving updates',
          message: 'Pulling remote updates.',
          steps: ['Validating Git state'],
        },
      ),
    ).rejects.toThrow('Pull failed');

    expect(useBlockingTaskStore.getState().open).toBe(false);
  });

  it('rejects concurrent task starts while one is active', async () => {
    let resolveTask: (value: string) => void = () => {};
    const first = blockingTask.run(
      () =>
        new Promise<string>((resolve) => {
          resolveTask = resolve;
        }),
      {
        title: 'Creating checkpoint',
        message: 'Saving changes.',
        steps: ['Validating Git state'],
      },
    );

    await expect(
      blockingTask.run(async () => 'second', {
        title: 'Changing scenario',
        message: 'Switching branches.',
        steps: ['Validating Git state'],
      }),
    ).rejects.toThrow('BLOCKING_TASK_ACTIVE');

    resolveTask('first');
    await expect(first).resolves.toBe('first');
  });
});
