import type { GitStatus } from '../api/types';

export type GitBadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface GitBadge {
  key: string;
  label: string;
  value: string;
  tone: GitBadgeTone;
  title: string;
}

export function gitStateBadges(status: GitStatus | null | undefined): GitBadge[] {
  return [
    scenarioBadge(status),
    checkpointBadge(status),
    publishBadge(status),
    conflictBadge(status),
  ];
}

function scenarioBadge(status: GitStatus | null | undefined): GitBadge {
  if (!status?.is_repo) {
    return badge('scenario', 'Scenario', 'Not open', 'neutral', 'No Git-backed workspace is open.');
  }
  return badge(
    'scenario',
    'Scenario',
    status.branch ?? 'Detached',
    status.branch ? 'info' : 'warning',
    status.branch
      ? `Current Git branch: ${status.branch}`
      : 'The workspace is not currently on a named branch.',
  );
}

function checkpointBadge(status: GitStatus | null | undefined): GitBadge {
  if (!status?.is_repo) {
    return badge(
      'checkpoint',
      'Checkpoint',
      'Unavailable',
      'neutral',
      'No repository state is available.',
    );
  }
  if (status.merge_in_progress || status.conflicted_files.length > 0) {
    return badge(
      'checkpoint',
      'Checkpoint',
      'Blocked',
      'danger',
      'Resolve or abort the conflict before checkpointing.',
    );
  }
  const pendingCount = status.changed_files.length + status.untracked_files.length;
  if (pendingCount === 0) {
    return badge(
      'checkpoint',
      'Checkpoint',
      'Saved',
      'success',
      'There are no pending model file changes.',
    );
  }
  return badge(
    'checkpoint',
    'Checkpoint',
    `${pendingCount} pending`,
    'warning',
    'Create a checkpoint before changing scenario, integrating, or syncing.',
  );
}

function publishBadge(status: GitStatus | null | undefined): GitBadge {
  if (!status?.is_repo) {
    return badge(
      'publish',
      'Publish',
      'Unavailable',
      'neutral',
      'No repository state is available.',
    );
  }
  if (!status.has_remote) {
    return badge(
      'publish',
      'Publish',
      'Local only',
      'neutral',
      'No remote repository is configured.',
    );
  }
  if (status.ahead > 0 && status.behind > 0) {
    return badge(
      'publish',
      'Publish',
      `${status.ahead} out / ${status.behind} in`,
      'warning',
      'Publish and receive changes are both pending.',
    );
  }
  if (status.behind > 0) {
    return badge(
      'publish',
      'Publish',
      `${status.behind} incoming`,
      'warning',
      'Receive upstream changes before publishing.',
    );
  }
  if (status.ahead > 0) {
    return badge(
      'publish',
      'Publish',
      `${status.ahead} ready`,
      'info',
      'Local checkpoints are ready to publish.',
    );
  }
  return badge('publish', 'Publish', 'Current', 'success', 'Local and remote history are aligned.');
}

function conflictBadge(status: GitStatus | null | undefined): GitBadge {
  if (!status?.is_repo) {
    return badge('conflict', 'Conflicts', 'n/a', 'neutral', 'No repository state is available.');
  }
  if (status.merge_in_progress || status.conflicted_files.length > 0) {
    const count = Math.max(status.conflicted_files.length, 1);
    return badge(
      'conflict',
      'Conflicts',
      `${count} file${count === 1 ? '' : 's'}`,
      'danger',
      'Integration conflict detected.',
    );
  }
  return badge(
    'conflict',
    'Conflicts',
    'Clear',
    'success',
    'No integration conflicts are detected.',
  );
}

function badge(
  key: string,
  label: string,
  value: string,
  tone: GitBadgeTone,
  title: string,
): GitBadge {
  return { key, label, value, tone, title };
}
