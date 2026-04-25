import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Text, Textarea, Dropdown, Option } from '@fluentui/react-components';
import type { Capability } from '../api/types';
import { api } from '../api/bridge';
import { useAppStore } from '../store/app-store';

function flatten(nodes: Capability[]): Capability[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

function TreeNode({ node, depth }: { node: Capability; depth: number }) {
  const selectedId = useAppStore((s) => s.selectedId);
  const setSelected = useAppStore((s) => s.setSelected);
  return (
    <div>
      <button
        className={`tree-row ${selectedId === node.id ? 'selected' : ''}`}
        style={{ paddingLeft: 12 + depth * 16 }}
        onClick={() => setSelected(node)}
      >
        <span className="tree-name">{node.name}</span>
        <span className="tree-kind">{node.type}</span>
      </button>
      {(node.children ?? []).map((child) => (
        <TreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export function CapabilityTreePanel() {
  const workspace = useAppStore((s) => s.workspace);
  const tree = useAppStore((s) => s.tree);
  const selected = useAppStore((s) => s.selected);
  const setTree = useAppStore((s) => s.setTree);
  const setSelected = useAppStore((s) => s.setSelected);
  const setError = useAppStore((s) => s.setError);
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [results, setResults] = useState<Capability[]>([]);

  async function refresh() {
    try {
      const next = await api.capabilities.listTree();
      setTree(next);
      if (selected) {
        const match = flatten(next).find((cap) => cap.id === selected.id) ?? null;
        setSelected(match);
      }
    } catch (error) {
      setError(String(error));
    }
  }

  useEffect(() => {
    if (workspace) void refresh();
  }, [workspace?.path]);

  async function create(parentId: string | null) {
    if (!newName.trim()) return;
    try {
      const created = await api.capabilities.create({ name: newName.trim(), parent_id: parentId });
      setNewName('');
      await refresh();
      setSelected(created);
    } catch (error) {
      setError(String(error));
    }
  }

  async function runSearch(value: string) {
    setQuery(value);
    if (!value.trim()) {
      setResults([]);
      return;
    }
    try {
      const found = await api.search.query(value);
      const ids = new Set(found.map((item) => item.id));
      setResults(flatten(tree).filter((item) => ids.has(item.id)));
    } catch (error) {
      setError(String(error));
    }
  }

  const flat = useMemo(() => flatten(tree), [tree]);

  return (
    <section className="panel stack">
      <div className="toolbar">
        <Input value={query} onChange={(_, data) => void runSearch(data.value)} placeholder="Search capabilities" />
        <Button onClick={refresh}>Refresh</Button>
      </div>
      <div className="toolbar">
        <Input value={newName} onChange={(_, data) => setNewName(data.value)} placeholder="New capability name" />
        <Button appearance="primary" onClick={() => void create(selected?.id ?? null)}>Add</Button>
        <Button onClick={() => void create(null)}>Add Root</Button>
      </div>
      {!workspace ? <Text>Open or initialize a workspace first.</Text> : null}
      {query.trim() ? (
        <div className="tree">
          {results.map((capability) => (
            <button key={capability.id} className="tree-row" onClick={() => setSelected(capability)}>
              <span>{capability.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="tree">
          {tree.map((node) => <TreeNode key={node.id} node={node} depth={0} />)}
        </div>
      )}
      <Text size={200}>{flat.length} capabilities</Text>
    </section>
  );
}

export function InspectorPanel() {
  const selected = useAppStore((s) => s.selected);
  const tree = useAppStore((s) => s.tree);
  const setSelected = useAppStore((s) => s.setSelected);
  const setTree = useAppStore((s) => s.setTree);
  const setError = useAppStore((s) => s.setError);
  const [draft, setDraft] = useState<Capability | null>(selected);

  useEffect(() => setDraft(selected), [selected?.id, selected?.updated_at]);

  async function save() {
    if (!draft) return;
    try {
      const updated = await api.capabilities.update(draft.id, draft);
      setSelected(updated);
      setTree(await api.capabilities.listTree());
    } catch (error) {
      setError(String(error));
    }
  }

  async function move(parentId: string | null) {
    if (!draft) return;
    try {
      const updated = await api.capabilities.move(draft.id, parentId);
      setSelected(updated);
      setTree(await api.capabilities.listTree());
    } catch (error) {
      setError(String(error));
    }
  }

  const candidates = flatten(tree).filter((cap) => cap.id !== draft?.id);

  if (!draft) return <section className="panel"><Text>Select a capability.</Text></section>;

  return (
    <section className="panel stack inspector">
      <Text weight="semibold">Capability Inspector</Text>
      <label>Name<Input value={draft.name} onChange={(_, d) => setDraft({ ...draft, name: d.value })} /></label>
      <label>Domain<Input value={draft.domain} onChange={(_, d) => setDraft({ ...draft, domain: d.value })} /></label>
      <label>Type
        <Dropdown selectedOptions={[draft.type]} value={draft.type} onOptionSelect={(_, d) => setDraft({ ...draft, type: d.optionValue as Capability['type'] })}>
          <Option value="abstract">abstract</Option>
          <Option value="leaf">leaf</Option>
        </Dropdown>
      </label>
      <label>Status
        <Dropdown selectedOptions={[draft.lifecycle_status]} value={draft.lifecycle_status} onOptionSelect={(_, d) => setDraft({ ...draft, lifecycle_status: d.optionValue as Capability['lifecycle_status'] })}>
          <Option value="Draft">Draft</Option>
          <Option value="Active">Active</Option>
          <Option value="Deprecated">Deprecated</Option>
          <Option value="Retired">Retired</Option>
        </Dropdown>
      </label>
      <label>Description<Textarea value={draft.description} onChange={(_, d) => setDraft({ ...draft, description: d.value })} /></label>
      <label>Aliases<Input value={draft.aliases.join('; ')} onChange={(_, d) => setDraft({ ...draft, aliases: d.value.split(';').map((v) => v.trim()).filter(Boolean) })} /></label>
      <label>Tags<Input value={draft.tags.join('; ')} onChange={(_, d) => setDraft({ ...draft, tags: d.value.split(';').map((v) => v.trim()).filter(Boolean) })} /></label>
      <label>Steward<Input value={draft.steward_id} onChange={(_, d) => setDraft({ ...draft, steward_id: d.value })} /></label>
      <label>Steward Department<Input value={draft.steward_department} onChange={(_, d) => setDraft({ ...draft, steward_department: d.value })} /></label>
      <label>Move under
        <Dropdown placeholder="Root" onOptionSelect={(_, d) => void move(d.optionValue || null)}>
          <Option value="">Root</Option>
          {candidates.map((candidate) => <Option key={candidate.id} value={candidate.id}>{candidate.name}</Option>)}
        </Dropdown>
      </label>
      <div className="toolbar"><Button appearance="primary" onClick={() => void save()}>Save</Button></div>
    </section>
  );
}
