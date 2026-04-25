import type { GitStatus } from '../api/types';
import { gitStateBadges } from './git-state';

export function GitBadges({
  status,
  compact = false,
}: {
  status: GitStatus | null | undefined;
  compact?: boolean;
}) {
  return (
    <div className={`git-badges ${compact ? 'compact' : ''}`} aria-label="Git workspace state">
      {gitStateBadges(status).map((badge) => (
        <span className={`git-badge ${badge.tone}`} key={badge.key} title={badge.title}>
          <span className="git-badge-label">{badge.label}</span>
          <strong>{badge.value}</strong>
        </span>
      ))}
    </div>
  );
}
