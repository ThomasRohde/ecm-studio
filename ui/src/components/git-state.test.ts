import { describe, expect, it } from 'vitest';
import type { GitStatus } from '../api/types';
import { gitStateBadges } from './git-state';

const baseStatus: GitStatus = {
  is_repo: true,
  clean: true,
  changed_files: [],
  untracked_files: [],
  conflicted_files: [],
  branch: 'main',
  branches: ['main'],
  has_remote: true,
  upstream: 'origin/main',
  ahead: 0,
  behind: 0,
  merge_in_progress: false,
};

describe('gitStateBadges', () => {
  it('labels a clean synced workspace as saved and current', () => {
    const badges = gitStateBadges(baseStatus);

    expect(badges.find((badge) => badge.key === 'scenario')?.value).toBe('main');
    expect(badges.find((badge) => badge.key === 'checkpoint')?.tone).toBe('success');
    expect(badges.find((badge) => badge.key === 'publish')?.value).toBe('Current');
    expect(badges.find((badge) => badge.key === 'conflict')?.value).toBe('Clear');
  });

  it('surfaces pending changes before risky workflows', () => {
    const badges = gitStateBadges({
      ...baseStatus,
      clean: false,
      changed_files: ['ecm/capabilities.jsonl'],
      untracked_files: ['ecm/model_versions.jsonl'],
    });

    expect(badges.find((badge) => badge.key === 'checkpoint')).toMatchObject({
      value: '2 pending',
      tone: 'warning',
    });
  });

  it('shows publish direction when remote history diverges', () => {
    const badges = gitStateBadges({ ...baseStatus, ahead: 2, behind: 1 });

    expect(badges.find((badge) => badge.key === 'publish')).toMatchObject({
      value: '2 out / 1 in',
      tone: 'warning',
    });
  });

  it('uses danger tone during integration conflicts', () => {
    const badges = gitStateBadges({
      ...baseStatus,
      clean: false,
      conflicted_files: ['ecm/capabilities.jsonl'],
      merge_in_progress: true,
    });

    expect(badges.find((badge) => badge.key === 'checkpoint')?.tone).toBe('danger');
    expect(badges.find((badge) => badge.key === 'conflict')).toMatchObject({
      value: '1 file',
      tone: 'danger',
    });
  });
});
