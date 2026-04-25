import { useEffect, useState } from 'react';
import { Button, Input, Text } from '@fluentui/react-components';
import { api } from '../api/bridge';
import type { AuditEvent, Checkpoint, ImportMode, ImportPreview, ModelFormat } from '../api/types';
import { useAppStore } from '../store/app-store';
import { useSettingsStore } from '../store/settings-store';

async function refreshModelState() {
  return {
    workspace: await api.workspace.status(),
    tree: await api.capabilities.listTree(),
    diagnostics: await api.diagnostics.run(),
    git: await api.git.status(),
  };
}

export function WorkspacePanel() {
  const workspace = useAppStore((s) => s.workspace);
  const setWorkspace = useAppStore((s) => s.setWorkspace);
  const setTree = useAppStore((s) => s.setTree);
  const setDiagnostics = useAppStore((s) => s.setDiagnostics);
  const setError = useAppStore((s) => s.setError);
  const settings = useSettingsStore((s) => s.settings);
  const loadSettings = useSettingsStore((s) => s.load);
  const [path, setPath] = useState(workspace?.path ?? '');
  const [name, setName] = useState('ECM Workspace');
  const [advanced, setAdvanced] = useState(false);

  async function refreshData() {
    const state = await refreshModelState();
    setWorkspace(state.workspace);
    setTree(state.tree);
    setDiagnostics(state.diagnostics);
  }

  async function open(openPath?: string) {
    try {
      const opened = await api.workspace.open(openPath ?? (path || undefined));
      setWorkspace(opened);
      setPath(opened.path);
      await refreshData();
      await loadSettings();
    } catch (error) {
      setError(String(error));
    }
  }

  async function pickOpen() {
    try {
      const opened = await api.workspace.pickOpen();
      if (!opened) return;
      setWorkspace(opened);
      setPath(opened.path);
      await refreshData();
      await loadSettings();
    } catch (error) {
      setError(String(error));
    }
  }

  async function pickInit() {
    try {
      const initialized = await api.workspace.pickInit(name);
      if (!initialized) return;
      setWorkspace(initialized);
      setPath(initialized.path);
      await refreshData();
      await loadSettings();
    } catch (error) {
      setError(String(error));
    }
  }

  async function init() {
    try {
      const initialized = await api.workspace.init(path, name);
      setWorkspace(initialized);
      await refreshData();
      await loadSettings();
    } catch (error) {
      setError(String(error));
    }
  }

  async function rebuild() {
    try {
      await api.workspace.rebuildIndex();
      await refreshData();
    } catch (error) {
      setError(String(error));
    }
  }

  return (
    <section className="panel stack">
      <Text weight="semibold">Workspace</Text>
      <Input value={name} onChange={(_, d) => setName(d.value)} placeholder="Workspace name" />
      <div className="toolbar">
        <Button appearance="primary" onClick={() => void pickOpen()}>Open Workspace</Button>
        <Button onClick={() => void pickInit()}>Create Workspace</Button>
        <Button disabled={!workspace} onClick={() => void rebuild()}>Rebuild Index</Button>
      </div>

      {settings.recent_workspaces.length ? (
        <div className="stack compact">
          <Text size={200} weight="semibold">Recent Workspaces</Text>
          {settings.recent_workspaces.map((recent) => (
            <button className="link-card" key={recent} onClick={() => void open(recent)} type="button">
              {recent}
            </button>
          ))}
        </div>
      ) : null}

      <Button appearance="subtle" onClick={() => setAdvanced((value) => !value)}>
        {advanced ? 'Hide advanced path entry' : 'Advanced: enter path manually'}
      </Button>
      {advanced ? (
        <div className="stack compact">
          <Input value={path} onChange={(_, d) => setPath(d.value)} placeholder="C:\\path\\to\\repo" />
          <div className="toolbar">
            <Button appearance="primary" onClick={() => void init()}>Initialize Path</Button>
            <Button onClick={() => void open()}>Open Path</Button>
          </div>
        </div>
      ) : null}

      {workspace ? (
        <div className="kv">
          <Text>Name: {workspace.name}</Text>
          <Text>Path: {workspace.path}</Text>
          <Text>Index: {workspace.index_current ? 'current' : 'stale'}</Text>
        </div>
      ) : <Text>No workspace open.</Text>}
    </section>
  );
}

export function ImportExportPanel() {
  const workspace = useAppStore((s) => s.workspace);
  const setWorkspace = useAppStore((s) => s.setWorkspace);
  const setTree = useAppStore((s) => s.setTree);
  const setDiagnostics = useAppStore((s) => s.setDiagnostics);
  const setGitStatus = useAppStore((s) => s.setGitStatus);
  const setError = useAppStore((s) => s.setError);
  const [format, setFormat] = useState<ModelFormat>('jsonl');
  const [mode, setMode] = useState<ImportMode>('append');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);

  useEffect(() => {
    setPreview(null);
  }, [mode, workspace?.path]);

  async function refreshAfterModelChange() {
    const state = await refreshModelState();
    setWorkspace(state.workspace);
    setTree(state.tree);
    setDiagnostics(state.diagnostics);
    setGitStatus(state.git);
  }

  async function previewImport() {
    try {
      const result = await api.models.importPreview(null, mode);
      if (result) setPreview(result);
    } catch (error) {
      setError(String(error));
    }
  }

  async function applyImport() {
    if (!preview) return;
    try {
      const result = await api.models.importApply(preview.source_path, preview.mode);
      setPreview(result);
      await refreshAfterModelChange();
    } catch (error) {
      setError(String(error));
    }
  }

  async function exportModel() {
    try {
      const result = await api.models.export(format);
      if (result) setExportPath(result.path);
    } catch (error) {
      setError(String(error));
    }
  }

  return (
    <section className="panel stack">
      <Text weight="semibold">Import / Export</Text>
      <Text size={200}>Move capabilities as JSONL, CSV, or portable JSON bundle.</Text>
      <div className="toolbar">
        <select className="select" value={format} onChange={(event) => setFormat(event.target.value as ModelFormat)}>
          <option value="jsonl">JSONL</option>
          <option value="csv">CSV</option>
          <option value="json_bundle">JSON bundle</option>
        </select>
        <Button disabled={!workspace} appearance="primary" onClick={() => void exportModel()}>
          Export Model
        </Button>
      </div>
      {exportPath ? <Text size={200}>Exported to {exportPath}</Text> : null}

      <div className="toolbar">
        <select className="select" value={mode} onChange={(event) => setMode(event.target.value as ImportMode)}>
          <option value="append">Append new capabilities</option>
          <option value="replace">Replace current model</option>
          <option value="merge_by_id">Merge by ID</option>
          <option value="validate_only">Validate only</option>
        </select>
        <Button disabled={!workspace} onClick={() => void previewImport()}>Choose File + Preview</Button>
        <Button disabled={!canApplyImportPreview(preview)} onClick={() => void applyImport()}>
          Apply Import
        </Button>
      </div>

      {preview ? (
        <div className="card">
          <Text weight="semibold">Preview: {preview.source_path}</Text>
          <Text size={200}>Format {preview.format}, mode {preview.mode}</Text>
          <div className="metric-row">
            <span>Total {preview.total}</span>
            <span>Added {preview.added}</span>
            <span>Updated {preview.updated}</span>
            <span>Skipped {preview.skipped}</span>
            <span>Invalid {preview.invalid}</span>
          </div>
          {preview.checkpoint_id ? <Text size={200}>Checkpoint: {preview.checkpoint_id.slice(0, 10)}</Text> : null}
          {preview.diagnostics.map((item, index) => (
            <div key={`${item.code}-${index}`} className={`card ${item.severity}`}>
              <Text weight="semibold">{item.code}</Text>
              <Text>{item.message}</Text>
              {item.path ? <Text size={200}>{item.path}{item.line ? `:${item.line}` : ''}</Text> : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function canApplyImportPreview(preview: ImportPreview | null): boolean {
  return Boolean(preview && preview.invalid === 0 && preview.mode !== 'validate_only');
}

export function GitPanel() {
  const gitStatus = useAppStore((s) => s.gitStatus);
  const setGitStatus = useAppStore((s) => s.setGitStatus);
  const setError = useAppStore((s) => s.setError);
  const [message, setMessage] = useState('ECM checkpoint');
  const [branchName, setBranchName] = useState('work/new-capability-model');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [history, setHistory] = useState<Checkpoint[]>([]);

  async function refresh() {
    try {
      const status = await api.git.status();
      setGitStatus(status);
      setSelectedBranch((current) => current || status.branches.find((branch) => branch !== status.branch) || status.branch || '');
      setHistory(await api.git.history());
    } catch (error) {
      setError(String(error));
    }
  }

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await refresh();
    } catch (error) {
      setError(String(error));
    }
  }

  async function checkpoint() {
    await run(() => api.git.checkpoint(message));
  }

  useEffect(() => { void refresh(); }, []);

  const branches = gitStatus?.branches ?? [];
  const clean = gitStatus?.clean ?? false;
  const isRepo = gitStatus?.is_repo ?? false;
  const mergeInProgress = gitStatus?.merge_in_progress ?? false;
  const canRisk = isRepo && clean && !mergeInProgress;

  return (
    <section className="panel stack">
      <Text weight="semibold">Git Workflows</Text>
      <div className="kv">
        <Text>Repo: {isRepo ? 'yes' : 'no'}</Text>
        <Text>Branch: {gitStatus?.branch ?? 'n/a'}</Text>
        <Text>State: {clean ? 'clean' : 'dirty - checkpoint before branch, sync, or merge'}</Text>
        <Text>Remote: {gitStatus?.has_remote ? gitStatus.upstream ?? 'configured' : 'local repo only'}</Text>
        <Text>Ahead/behind: {gitStatus?.ahead ?? 0}/{gitStatus?.behind ?? 0}</Text>
        <Text>Changed: {gitStatus?.changed_files?.length ?? 0}; Untracked: {gitStatus?.untracked_files?.length ?? 0}</Text>
      </div>

      {mergeInProgress ? (
        <div className="card error">
          <Text weight="semibold">Merge conflict detected</Text>
          {(gitStatus?.conflicted_files ?? []).map((file) => <Text key={file}>{file}</Text>)}
          <Button appearance="primary" onClick={() => void run(() => api.git.abortMerge())}>Abort Merge</Button>
        </div>
      ) : null}

      <div className="toolbar">
        <Input value={message} onChange={(_, d) => setMessage(d.value)} />
        <Button disabled={!isRepo} appearance="primary" onClick={() => void checkpoint()}>Checkpoint</Button>
        <Button onClick={() => void refresh()}>Refresh</Button>
      </div>

      <div className="workflow-grid">
        <div className="card">
          <Text weight="semibold">Start New Work</Text>
          <Input value={branchName} onChange={(_, d) => setBranchName(d.value)} />
          <Button disabled={!canRisk} onClick={() => void run(() => api.git.createBranch(branchName))}>Create + Switch Branch</Button>
        </div>
        <div className="card">
          <Text weight="semibold">Switch / Merge</Text>
          <select className="select" value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)}>
            {branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
          </select>
          <div className="toolbar">
            <Button disabled={!canRisk || !selectedBranch} onClick={() => void run(() => api.git.switchBranch(selectedBranch))}>Switch</Button>
            <Button disabled={!canRisk || !selectedBranch || selectedBranch === gitStatus?.branch} onClick={() => void run(() => api.git.mergeBranch(selectedBranch))}>Merge Into Current</Button>
          </div>
        </div>
        <div className="card">
          <Text weight="semibold">Sync Remote</Text>
          <Text size={200}>{gitStatus?.has_remote ? 'Remote is configured.' : 'No remote configured; local Git only.'}</Text>
          <div className="toolbar">
            <Button disabled={!canRisk || !gitStatus?.has_remote} onClick={() => void run(() => api.git.pull())}>Sync</Button>
            <Button disabled={!isRepo || !gitStatus?.has_remote} onClick={() => void run(() => api.git.push())}>Publish</Button>
          </div>
        </div>
      </div>

      <div className="list">
        {history.map((item) => (
          <div key={item.id || item.message} className="card">
            <Text weight="semibold">{item.message}</Text>
            <Text size={200}>{item.id.slice(0, 10)} {item.timestamp}</Text>
          </div>
        ))}
      </div>
    </section>
  );
}

export function DiagnosticsPanel() {
  const diagnostics = useAppStore((s) => s.diagnostics);
  const setDiagnostics = useAppStore((s) => s.setDiagnostics);
  const setError = useAppStore((s) => s.setError);

  async function run() {
    try {
      setDiagnostics(await api.diagnostics.run());
    } catch (error) {
      setError(String(error));
    }
  }

  useEffect(() => { void run(); }, []);

  return (
    <section className="panel stack">
      <div className="toolbar"><Text weight="semibold">Diagnostics</Text><Button onClick={() => void run()}>Run</Button></div>
      {diagnostics.length === 0 ? <Text>No diagnostics.</Text> : diagnostics.map((item, index) => (
        <div key={`${item.code}-${index}`} className={`card ${item.severity}`}>
          <Text weight="semibold">{item.code}</Text>
          <Text>{item.message}</Text>
          {item.path ? <Text size={200}>{item.path}{item.line ? `:${item.line}` : ''}</Text> : null}
        </div>
      ))}
    </section>
  );
}

export function AuditPanel() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const setError = useAppStore((s) => s.setError);

  async function refresh() {
    try {
      setEvents(await api.audit.recent());
      setExpandedKey(null);
    } catch (error) {
      setError(String(error));
    }
  }

  useEffect(() => { void refresh(); }, []);

  return (
    <section className="panel stack audit-panel">
      <div className="toolbar">
        <Text weight="semibold">Audit</Text>
        <Button onClick={() => void refresh()}>Refresh</Button>
      </div>
      {events.length === 0 ? <Text>No audit events recorded yet.</Text> : null}
      <div className="audit-list">
        {events.map((event, index) => (
          <AuditListItem
            event={event}
            expanded={expandedKey === auditEventKey(event, index)}
            key={auditEventKey(event, index)}
            onToggle={() => {
              const key = auditEventKey(event, index);
              setExpandedKey((current) => current === key ? null : key);
            }}
          />
        ))}
      </div>
    </section>
  );
}

function AuditListItem({
  event,
  expanded,
  onToggle,
}: {
  event: AuditEvent;
  expanded: boolean;
  onToggle: () => void;
}) {
  const record = event.record;
  const action = auditField(record, 'action') ?? (event.error ? 'error' : 'event');
  const title = auditField(record, 'summary') ?? event.error?.message ?? 'Audit event';
  const timestamp = auditField(record, 'created_at') ?? auditField(record, 'updated_at') ?? 'No timestamp';
  const target = auditTarget(record);
  const actor = auditField(record, 'actor');
  const detailPayload = event.error ?? record ?? {};

  return (
    <article className={`audit-item ${event.error ? 'error' : ''}`}>
      <div className="audit-row">
        <div className="audit-action-mark" aria-hidden="true">{action.slice(0, 1).toUpperCase()}</div>
        <div className="audit-summary">
          <div className="audit-title-row">
            <Text weight="semibold">{title}</Text>
            <span className="audit-pill">{action}</span>
          </div>
          <div className="audit-meta-row">
            <span>{timestamp}</span>
            {target ? <span>{target}</span> : null}
            {actor ? <span>Actor: {actor}</span> : null}
            <span>{event.source}:{event.line}</span>
          </div>
        </div>
        <Button appearance="subtle" onClick={onToggle}>
          {expanded ? 'Hide Details' : 'Details'}
        </Button>
      </div>
      {expanded ? (
        <div className="audit-details">
          <div className="audit-detail-grid">
            <span>Source</span><strong>{event.source}:{event.line}</strong>
            <span>Action</span><strong>{action}</strong>
            <span>Target</span><strong>{target || 'n/a'}</strong>
            <span>Timestamp</span><strong>{timestamp}</strong>
          </div>
          <pre className="audit-record">{JSON.stringify(detailPayload, null, 2)}</pre>
        </div>
      ) : null}
    </article>
  );
}

function auditEventKey(event: AuditEvent, index: number) {
  const id = auditField(event.record, 'id');
  return `${event.source}:${event.line}:${id ?? index}`;
}

function auditField(record: AuditEvent['record'], key: string): string | null {
  const value = record?.[key];
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function auditTarget(record: AuditEvent['record']) {
  const capabilityId = auditField(record, 'capability_id');
  if (capabilityId) return `Capability ${capabilityId.slice(0, 8)}`;
  const checkpointId = auditField(record, 'checkpoint_id');
  if (checkpointId) return `Checkpoint ${checkpointId.slice(0, 10)}`;
  const count = auditField(record, 'capability_count');
  if (count) return `${count} capabilities`;
  return null;
}
