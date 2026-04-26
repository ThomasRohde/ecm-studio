import { Text } from '@fluentui/react-components';
import { useAppStore } from '../store/app-store';

export function StatusBar() {
  const appInfo = useAppStore((s) => s.appInfo);
  const workspace = useAppStore((s) => s.workspace);
  const gitStatus = useAppStore((s) => s.gitStatus);
  const selected = useAppStore((s) => s.selected);
  const error = useAppStore((s) => s.error);

  const gitState = gitStatus ? (gitStatus.clean ? 'clean' : 'dirty') : 'idle';
  const gitLabel = gitStatus ? (gitStatus.clean ? 'clean' : 'dirty') : 'n/a';

  return (
    <footer className="statusbar">
      <Text size={200} className="status-workspace" title={workspace?.path ?? 'No workspace'}>
        <span className="status-segment-label">WS</span>
        {workspace ? workspace.path : 'No workspace'}
      </Text>
      <Text size={200}>
        <span className={`status-pulse ${gitState}`} aria-hidden="true" />
        <span className="status-segment-label">Git</span>
        {gitLabel}
      </Text>
      <Text size={200}>
        <span className="status-segment-label">Idx</span>
        {workspace?.index_current ? 'current' : 'n/a'}
      </Text>
      <Text size={200}>
        <span className="status-segment-label">Sel</span>
        {selected?.name ?? 'none'}
      </Text>
      {error ? (
        <Text size={200} className="status-error" title={error}>
          <span className="status-segment-label">Err</span>
          {error}
        </Text>
      ) : null}
      <Text size={200} className="status-version">
        {appInfo ? `${appInfo.name} v${appInfo.version}` : 'ECM Studio'}
      </Text>
    </footer>
  );
}
