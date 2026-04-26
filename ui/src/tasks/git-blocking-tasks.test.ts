import { describe, expect, it } from 'vitest';
import { type GitBlockingTaskName, gitBlockingTaskOptions } from './git-blocking-tasks';

describe('git blocking task metadata', () => {
  it.each<[GitBlockingTaskName, string]>([
    ['checkpoint', 'Creating checkpoint'],
    ['createBranch', 'Creating scenario'],
    ['switchBranch', 'Changing scenario'],
    ['pull', 'Receiving updates'],
    ['mergeBranch', 'Integrating scenario'],
    ['abortMerge', 'Aborting integration'],
    ['cutRelease', 'Cutting release'],
    ['publishRelease', 'Publishing release'],
  ])('maps %s to the expected dialog title', (name, title) => {
    expect(gitBlockingTaskOptions(name).title).toBe(title);
  });

  it('uses generic Git steps for routine mutations', () => {
    expect(gitBlockingTaskOptions('checkpoint').steps).toEqual([
      'Validating Git state',
      'Running Git operation',
      'Refreshing workspace state',
    ]);
  });

  it('uses release-specific steps for release cut and publish', () => {
    expect(gitBlockingTaskOptions('cutRelease').steps).toEqual([
      'Validating release inputs',
      'Checking release blockers',
      'Running diagnostics and release creation',
      'Refreshing Git and release state',
    ]);
    expect(gitBlockingTaskOptions('publishRelease').steps).toEqual([
      'Validating release target',
      'Pushing release tag and assets',
      'Publishing release metadata',
      'Refreshing Git and release state',
    ]);
  });

  it('preserves caller details without sharing step arrays', () => {
    const first = gitBlockingTaskOptions('mergeBranch', 'Source: work/demo');
    const second = gitBlockingTaskOptions('mergeBranch');
    first.steps.push('Local mutation');

    expect(first.details).toBe('Source: work/demo');
    expect(second.steps).not.toContain('Local mutation');
  });
});
