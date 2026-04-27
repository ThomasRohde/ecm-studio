import type { BlockingTaskOptions } from './blocking-task-store';

export type GitBlockingTaskName =
  | 'checkpoint'
  | 'createBranch'
  | 'switchBranch'
  | 'pull'
  | 'mergeBranch'
  | 'abortMerge'
  | 'restoreCheckpoint'
  | 'discardPendingChanges'
  | 'cutRelease'
  | 'publishRelease';

const GENERIC_GIT_STEPS = [
  'Validating Git state',
  'Running Git operation',
  'Refreshing workspace state',
];

const RELEASE_CUT_STEPS = [
  'Validating release inputs',
  'Checking release blockers',
  'Running diagnostics and release creation',
  'Refreshing Git and release state',
];

const RELEASE_PUBLISH_STEPS = [
  'Validating release target',
  'Pushing release tag and assets',
  'Publishing release metadata',
  'Refreshing Git and release state',
];

const TASKS: Record<GitBlockingTaskName, Omit<BlockingTaskOptions, 'details'>> = {
  checkpoint: {
    title: 'Creating checkpoint',
    message: 'Saving current model changes as a Git checkpoint.',
    kind: 'git',
    steps: GENERIC_GIT_STEPS,
  },
  createBranch: {
    title: 'Creating scenario',
    message: 'Creating the new scenario branch and refreshing Git state.',
    kind: 'git',
    steps: GENERIC_GIT_STEPS,
  },
  switchBranch: {
    title: 'Changing scenario',
    message: 'Switching the workspace to another scenario.',
    kind: 'git',
    steps: GENERIC_GIT_STEPS,
  },
  pull: {
    title: 'Receiving updates',
    message: 'Pulling remote updates for the current scenario.',
    kind: 'git',
    steps: GENERIC_GIT_STEPS,
  },
  mergeBranch: {
    title: 'Integrating scenario',
    message: 'Merging the selected scenario into the current scenario.',
    kind: 'git',
    steps: GENERIC_GIT_STEPS,
  },
  abortMerge: {
    title: 'Aborting integration',
    message: 'Clearing the current merge state.',
    kind: 'git',
    steps: GENERIC_GIT_STEPS,
  },
  restoreCheckpoint: {
    title: 'Reverting checkpoint',
    message: 'Restoring model files from the selected checkpoint.',
    kind: 'git',
    steps: GENERIC_GIT_STEPS,
  },
  discardPendingChanges: {
    title: 'Discarding pending changes',
    message: 'Reverting tracked files and deleting untracked files.',
    kind: 'git',
    steps: GENERIC_GIT_STEPS,
  },
  cutRelease: {
    title: 'Cutting release',
    message: 'Creating release metadata, exports, checkpoint, and tag.',
    kind: 'release',
    steps: RELEASE_CUT_STEPS,
  },
  publishRelease: {
    title: 'Publishing release',
    message: 'Pushing the release tag and creating the GitHub release.',
    kind: 'release',
    steps: RELEASE_PUBLISH_STEPS,
  },
};

export function gitBlockingTaskOptions(
  name: GitBlockingTaskName,
  details?: string,
): BlockingTaskOptions {
  const task = TASKS[name];
  return {
    ...task,
    steps: [...task.steps],
    details,
  };
}
