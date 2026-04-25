import { Text } from '@fluentui/react-components';
import { useAppStore } from '../store/app-store';

export function StatusBar() {
  const workspace = useAppStore((s) => s.workspace);
  const gitStatus = useAppStore((s) => s.gitStatus);
  const selected = useAppStore((s) => s.selected);
  const error = useAppStore((s) => s.error);
  return (
    <footer className="statusbar">
      <Text size={200}>{workspace ? workspace.path : 'No workspace'}</Text>
      <Text size={200}>Git: {gitStatus?.clean ? 'clean' : gitStatus ? 'dirty' : 'n/a'}</Text>
      <Text size={200}>Index: {workspace?.index_current ? 'current' : 'n/a'}</Text>
      <Text size={200}>Selected: {selected?.name ?? 'none'}</Text>
      {error ? <Text size={200} className="status-error">{error}</Text> : null}
    </footer>
  );
}
