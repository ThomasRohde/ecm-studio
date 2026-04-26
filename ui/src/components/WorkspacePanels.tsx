import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { Button, Input, Text } from '@fluentui/react-components';
import { Gitgraph, MergeStyle, Mode, Orientation, TemplateName, templateExtend } from '@gitgraph/react';
import { api } from '../api/bridge';
import type { AuditEvent, BranchIntegrationCandidate, Checkpoint, GitGraphData, GitStatus, ImportMode, ImportPreview, ModelFormat, ReleaseBlocker, ReleaseStatus } from '../api/types';
import { notify, errorMessage } from '../notifications/notify';
import { useAppStore } from '../store/app-store';
import { useSettingsStore } from '../store/settings-store';
import { GitBadges } from './GitBadges';

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
      notify.success({
        intent: 'workspace.opened',
        title: 'Workspace opened',
        body: opened.name,
        source: 'workspace',
        dedupeKey: `workspace.open.${opened.path}`,
        action: { label: 'Open workspace', panelId: 'workspace' },
      });
    } catch (error) {
      notify.error({
        intent: 'operation.failed',
        title: 'Could not open workspace',
        body: errorMessage(error),
        source: 'workspace',
        dedupeKey: `workspace.open.${openPath ?? path ?? 'picker'}`,
        action: { label: 'Open workspace', panelId: 'workspace' },
      });
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
      notify.success({
        intent: 'workspace.opened',
        title: 'Workspace opened',
        body: opened.name,
        source: 'workspace',
        dedupeKey: `workspace.open.${opened.path}`,
        action: { label: 'Open workspace', panelId: 'workspace' },
      });
    } catch (error) {
      notify.error({
        intent: 'operation.failed',
        title: 'Could not open workspace',
        body: errorMessage(error),
        source: 'workspace',
        dedupeKey: 'workspace.open.picker',
        action: { label: 'Open workspace', panelId: 'workspace' },
      });
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
      notify.success({
        intent: 'workspace.created',
        title: 'Workspace created',
        body: initialized.name,
        source: 'workspace',
        dedupeKey: `workspace.create.${initialized.path}`,
        action: { label: 'Open workspace', panelId: 'workspace' },
      });
    } catch (error) {
      notify.error({
        intent: 'operation.failed',
        title: 'Could not create workspace',
        body: errorMessage(error),
        source: 'workspace',
        dedupeKey: 'workspace.create.picker',
        action: { label: 'Open workspace', panelId: 'workspace' },
      });
    }
  }

  async function init() {
    try {
      const initialized = await api.workspace.init(path, name);
      setWorkspace(initialized);
      await refreshData();
      await loadSettings();
      notify.success({
        intent: 'workspace.created',
        title: 'Workspace created',
        body: initialized.name,
        source: 'workspace',
        dedupeKey: `workspace.create.${initialized.path}`,
        action: { label: 'Open workspace', panelId: 'workspace' },
      });
    } catch (error) {
      notify.error({
        intent: 'operation.failed',
        title: 'Could not initialize workspace',
        body: errorMessage(error),
        source: 'workspace',
        dedupeKey: `workspace.create.${path}`,
        action: { label: 'Open workspace', panelId: 'workspace' },
      });
    }
  }

  async function rebuild() {
    try {
      await api.workspace.rebuildIndex();
      await refreshData();
      notify.success({
        intent: 'workspace.index.rebuilt',
        title: 'Index rebuilt',
        body: 'Workspace search and diagnostics are current.',
        source: 'workspace',
        dedupeKey: `workspace.index.${workspace?.path ?? 'current'}`,
        action: { label: 'Open diagnostics', panelId: 'diagnostics' },
      });
    } catch (error) {
      notify.error({
        intent: 'operation.failed',
        title: 'Could not rebuild index',
        body: errorMessage(error),
        source: 'workspace',
        dedupeKey: `workspace.index.${workspace?.path ?? 'current'}`,
        action: { label: 'Open diagnostics', panelId: 'diagnostics' },
      });
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
      if (result) {
        setPreview(result);
        const invalid = result.invalid > 0;
        const title = invalid ? 'Import validation failed' : 'Import preview validated';
        const body = invalid
          ? `${result.invalid} invalid rows found.`
          : `${result.total} rows checked.`;
        notify[invalid ? 'warning' : 'success']({
          intent: 'import.validated',
          title,
          body,
          source: 'import',
          dedupeKey: `import.preview.${result.source_path}`,
          action: { label: 'Open import/export', panelId: 'import_export' },
        });
      }
    } catch (error) {
      notify.error({
        intent: 'operation.failed',
        title: 'Could not preview import',
        body: errorMessage(error),
        source: 'import',
        action: { label: 'Open import/export', panelId: 'import_export' },
      });
    }
  }

  async function applyImport() {
    if (!preview) return;
    try {
      const result = await api.models.importApply(preview.source_path, preview.mode);
      setPreview(result);
      await refreshAfterModelChange();
      notify.success({
        intent: 'import.applied',
        title: 'Import applied',
        body: `${result.added} added, ${result.updated} updated, ${result.skipped} skipped.`,
        source: 'import',
        dedupeKey: `import.apply.${result.source_path}`,
        action: { label: 'Open import/export', panelId: 'import_export' },
      });
    } catch (error) {
      notify.error({
        intent: 'operation.failed',
        title: 'Could not apply import',
        body: errorMessage(error),
        source: 'import',
        dedupeKey: `import.apply.${preview.source_path}`,
        action: { label: 'Open import/export', panelId: 'import_export' },
      });
    }
  }

  async function exportModel() {
    try {
      const result = await api.models.export(format);
      if (result) {
        setExportPath(result.path);
        notify.success({
          intent: 'model.exported',
          title: 'Model exported',
          body: `${result.count} capabilities exported to ${result.path}.`,
          source: 'model',
          dedupeKey: `model.export.${result.path}`,
          action: { label: 'Open import/export', panelId: 'import_export' },
        });
      }
    } catch (error) {
      notify.error({
        intent: 'operation.failed',
        title: 'Could not export model',
        body: errorMessage(error),
        source: 'model',
        action: { label: 'Open import/export', panelId: 'import_export' },
      });
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
  const [message, setMessage] = useState('ECM checkpoint');
  const [branchName, setBranchName] = useState('work/new-capability-model');
  const [contextBranch, setContextBranch] = useState('');
  const [integrationBranch, setIntegrationBranch] = useState('');
  const [integrationCandidates, setIntegrationCandidates] = useState<BranchIntegrationCandidate[]>([]);
  const [releaseVersion, setReleaseVersion] = useState('0.1.0');
  const [releaseStatus, setReleaseStatus] = useState<ReleaseStatus | null>(null);
  const [history, setHistory] = useState<Checkpoint[]>([]);
  const [graph, setGraph] = useState<GitGraphData | null>(null);

  async function refresh() {
    try {
      const [status, nextHistory, nextGraph, nextReleaseStatus, nextIntegrationCandidates] = await Promise.all([
        api.git.status(),
        api.git.history(),
        api.git.graph(),
        api.releases.status(),
        api.git.integrationCandidates(),
      ]);
      setGitStatus(status);
      setContextBranch((current) => validBranchOrFallback(current, status.branches, status.branch));
      setIntegrationBranch((current) => validIntegrationBranchOrFallback(current, nextIntegrationCandidates));
      setIntegrationCandidates(nextIntegrationCandidates);
      setHistory(nextHistory);
      setGraph(nextGraph);
      setReleaseStatus(nextReleaseStatus);
    } catch (error) {
      notify.error({
        intent: 'operation.failed',
        title: 'Could not refresh Git state',
        body: errorMessage(error),
        source: 'git',
        dedupeKey: `git.refresh.${gitStatus?.branch ?? 'current'}`,
        action: { label: 'Open Git', panelId: 'git' },
      });
    }
  }

  async function runGitOperation<T>(
    action: () => Promise<T>,
    success: {
      intent: 'git.checkpoint.created'
        | 'git.branch.created'
        | 'git.branch.switched'
        | 'git.pull.completed'
        | 'git.merge.completed'
        | 'git.merge.aborted'
        | 'release.cut'
        | 'release.published';
      title: string;
      body?: string | ((result: T) => string | undefined);
      source?: 'git' | 'release';
      dedupeKey: string;
    },
    errorTitle: string,
  ) {
    try {
      const result = await action();
      const body = typeof success.body === 'function' ? success.body(result) : success.body;
      notify.success({
        intent: success.intent,
        title: success.title,
        body,
        source: success.source ?? 'git',
        dedupeKey: success.dedupeKey,
        action: { label: 'Open Git', panelId: 'git' },
      });
    } catch (error) {
      notify.error({
        intent: 'operation.failed',
        title: errorTitle,
        body: errorMessage(error),
        source: success.source ?? 'git',
        dedupeKey: `${success.dedupeKey}.error`,
        action: { label: 'Open Git', panelId: 'git' },
      });
      return;
    }

    await refresh();
  }

  async function checkpoint() {
    const branch = gitStatus?.branch ?? 'current';
    await runGitOperation(
      () => api.git.checkpoint(message),
      {
        intent: 'git.checkpoint.created',
        title: 'Checkpoint created',
        body: (result) => `${result.message} (${result.id.slice(0, 10)})`,
        dedupeKey: `git.checkpoint.${branch}`,
      },
      'Could not create checkpoint',
    );
  }

  async function createBranch() {
    await runGitOperation(
      () => api.git.createBranch(branchName),
      {
        intent: 'git.branch.created',
        title: 'Scenario created',
        body: `Now editing ${branchName}.`,
        dedupeKey: `git.branch.${branchName}`,
      },
      'Could not create scenario',
    );
  }

  async function switchBranch() {
    await runGitOperation(
      () => api.git.switchBranch(contextBranch),
      {
        intent: 'git.branch.switched',
        title: 'Scenario changed',
        body: `Now editing ${contextBranch}.`,
        dedupeKey: `git.switch.${contextBranch}`,
      },
      'Could not change scenario',
    );
  }

  async function pull() {
    const branch = gitStatus?.branch ?? 'current';
    await runGitOperation(
      () => api.git.pull(),
      {
        intent: 'git.pull.completed',
        title: 'Updates received',
        body: `Scenario ${branch} is current.`,
        dedupeKey: `git.pull.${branch}`,
      },
      'Could not receive updates',
    );
  }

  async function mergeBranch() {
    const target = gitStatus?.branch ?? 'current';
    await runGitOperation(
      () => api.git.mergeBranch(integrationBranch),
      {
        intent: 'git.merge.completed',
        title: 'Scenario integrated',
        body: `${integrationBranch} integrated into ${target}.`,
        dedupeKey: `git.merge.${integrationBranch}`,
      },
      'Could not integrate scenario',
    );
  }

  async function abortMerge() {
    const branch = gitStatus?.branch ?? 'current';
    await runGitOperation(
      () => api.git.abortMerge(),
      {
        intent: 'git.merge.aborted',
        title: 'Integration aborted',
        body: `Merge state cleared for ${branch}.`,
        dedupeKey: `git.merge.abort.${branch}`,
      },
      'Could not abort integration',
    );
  }

  async function cutRelease() {
    await runGitOperation(
      () => api.releases.cut(releaseVersion),
      {
        intent: 'release.cut',
        title: 'Release cut',
        body: (result) => `${result.tag} is ready to publish.`,
        source: 'release',
        dedupeKey: `release.cut.${releaseVersion}`,
      },
      'Could not cut release',
    );
  }

  async function publishRelease() {
    const tag = releaseStatus?.latest_release?.tag;
    if (!tag) return;
    await runGitOperation(
      () => api.releases.publish(tag),
      {
        intent: 'release.published',
        title: 'Release published',
        body: (result) => result.github_release_url,
        source: 'release',
        dedupeKey: `release.publish.${tag}`,
      },
      'Could not publish release',
    );
  }

  async function openReleaseUrl(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const url = releaseStatus?.latest_release?.github_release_url;
    if (!url) return;
    try {
      await api.external.openUrl(url);
    } catch (error) {
      notify.error({
        intent: 'operation.failed',
        title: 'Could not open release URL',
        body: errorMessage(error),
        source: 'release',
        dedupeKey: `release.url.${url}`,
        action: { label: 'Open Git', panelId: 'git' },
      });
    }
  }

  useEffect(() => { void refresh(); }, []);

  const branches = gitStatus?.branches ?? [];
  const clean = gitStatus?.clean ?? false;
  const isRepo = gitStatus?.is_repo ?? false;
  const mergeInProgress = gitStatus?.merge_in_progress ?? false;
  const canRisk = isRepo && clean && !mergeInProgress;
  const integrableBranches = integrationCandidates
    .filter((candidate) => candidate.integrable)
    .map((candidate) => candidate.name);
  const pendingCount = (gitStatus?.changed_files?.length ?? 0) + (gitStatus?.untracked_files?.length ?? 0);
  const releaseTag = releaseTagForVersion(releaseVersion);
  const canCut = canCutRelease(releaseStatus, gitStatus, releaseVersion);
  const canPublish = canPublishRelease(releaseStatus, gitStatus);
  const remoteLabel = releaseStatus?.remote?.is_github
    ? `${releaseStatus.remote.host}/${releaseStatus.remote.owner}/${releaseStatus.remote.repo}`
    : gitStatus?.has_remote
      ? gitStatus.upstream ?? 'Remote configured'
      : 'Local workspace only';

  return (
    <section className="panel stack">
      <div className="git-panel-header">
        <div>
          <Text weight="semibold">Scenario History</Text>
          <Text size={200}>Checkpoints, scenarios, publishing, and integration.</Text>
        </div>
        <Button onClick={() => void refresh()}>Refresh</Button>
      </div>
      <GitBadges status={gitStatus} />

      {mergeInProgress ? (
        <div className="card error workflow-card">
          <Text weight="semibold">Integration conflict detected</Text>
          <Text size={200}>Abort the integration before changing scenario or publishing.</Text>
          {(gitStatus?.conflicted_files ?? []).map((file) => <Text key={file}>{file}</Text>)}
          <Button appearance="primary" onClick={() => void abortMerge()}>Abort Integration</Button>
        </div>
      ) : null}

      <div className="workflow-grid">
        <div className="card workflow-card">
          <Text weight="semibold">Checkpoint</Text>
          <Text size={200}>{pendingCount ? `${pendingCount} pending file changes.` : 'No pending file changes.'}</Text>
          <Input value={message} onChange={(_, d) => setMessage(d.value)} aria-label="Checkpoint message" />
          <Button disabled={!isRepo || mergeInProgress} appearance="primary" onClick={() => void checkpoint()}>
            Create Checkpoint
          </Button>
        </div>

        <div className="card workflow-card">
          <Text weight="semibold">New Scenario</Text>
          <Text size={200}>Starts from {gitStatus?.branch ?? 'the current scenario'}.</Text>
          <Input value={branchName} onChange={(_, d) => setBranchName(d.value)} aria-label="Scenario name" />
          <Button disabled={!canRisk} onClick={() => void createBranch()}>
            Create Scenario
          </Button>
        </div>

        <div className="card workflow-card">
          <Text weight="semibold">Change Scenario</Text>
          <Text size={200}>Open another scenario for editing.</Text>
          <select className="select" value={contextBranch} onChange={(event) => setContextBranch(event.target.value)}>
            {branches.map((branch) => <option key={branch} value={branch}>{branch}</option>)}
          </select>
          <Button disabled={!canRisk || !contextBranch || contextBranch === gitStatus?.branch} onClick={() => void switchBranch()}>
            Change Scenario
          </Button>
        </div>

        <div className="card workflow-card">
          <Text weight="semibold">Integrate Scenario</Text>
          <Text size={200}>Bring another scenario into {gitStatus?.branch ?? 'the current scenario'}.</Text>
          <select className="select" value={integrationBranch} onChange={(event) => setIntegrationBranch(event.target.value)}>
            {integrableBranches.length ? integrableBranches.map((branch) => <option key={branch} value={branch}>{branch}</option>) : <option value="">No scenarios with pending integration</option>}
          </select>
          <Button disabled={!canRisk || !integrationBranch || !integrableBranches.includes(integrationBranch)} onClick={() => void mergeBranch()}>
            Integrate Into Current
          </Button>
        </div>

        <div className="card workflow-card">
          <Text weight="semibold">Release</Text>
          <Text size={200}>{remoteLabel}</Text>
          <Text size={200}>Outgoing {gitStatus?.ahead ?? 0}; incoming {gitStatus?.behind ?? 0}</Text>
          <label className="field-label">
            Version
            <Input value={releaseVersion} onChange={(_, d) => setReleaseVersion(d.value)} aria-label="Release version" />
          </label>
          <Text size={200}>Tag {releaseTag}</Text>
          {releaseStatus?.latest_release ? (
            <Text size={200}>Latest {releaseStatus.latest_release.tag} ({releaseStatus.latest_release.state})</Text>
          ) : null}
          <div className="toolbar">
            <Button disabled={!canRisk || !gitStatus?.has_remote} onClick={() => void pull()}>
              Receive Updates
            </Button>
            <Button disabled={!canCut} appearance="primary" onClick={() => void cutRelease()}>
              Cut Release
            </Button>
            <Button disabled={!canPublish} onClick={() => void publishRelease()}>
              Publish Release
            </Button>
          </div>
          <ReleaseBlockers blockers={releaseStatus?.cut_blockers ?? []} title="Cut blocked" />
          <ReleaseBlockers blockers={releaseStatus?.publish_blockers ?? []} title="Publish blocked" />
          {releaseStatus?.latest_release?.github_release_url ? (
            <a
              className="release-link"
              href={releaseStatus.latest_release.github_release_url}
              onClick={(event) => void openReleaseUrl(event)}
            >
              {releaseStatus.latest_release.github_release_url}
            </a>
          ) : null}
        </div>
      </div>

      <GitGraphView graph={graph} />

      <details className="checkpoint-expander">
        <summary>
          <Text weight="semibold">Recent Checkpoints</Text>
          <span className="audit-pill">{history.length}</span>
        </summary>
        <div className="list">
          {history.map((item) => (
            <div key={item.id || item.message} className="card">
              <Text weight="semibold">{item.message}</Text>
              <Text size={200}>{item.id.slice(0, 10)} {item.timestamp}</Text>
            </div>
          ))}
          {history.length === 0 ? <Text size={200}>No checkpoints yet.</Text> : null}
        </div>
      </details>
    </section>
  );
}

export function releaseTagForVersion(version: string): string {
  const normalized = version.trim();
  return /^(\d+\.\d+\.\d+)$/.test(normalized) ? `ecm-v${normalized}` : 'ecm-vX.Y.Z';
}

export function canCutRelease(
  releaseStatus: ReleaseStatus | null | undefined,
  gitStatus: GitStatus | null | undefined,
  version: string,
): boolean {
  return Boolean(
    gitStatus?.is_repo
      && gitStatus.clean
      && gitStatus.has_remote
      && !gitStatus.merge_in_progress
      && releaseStatus?.can_cut
      && releaseTagForVersion(version) !== 'ecm-vX.Y.Z',
  );
}

export function canPublishRelease(
  releaseStatus: ReleaseStatus | null | undefined,
  gitStatus: GitStatus | null | undefined,
): boolean {
  return Boolean(
    gitStatus?.is_repo
      && gitStatus.clean
      && gitStatus.has_remote
      && !gitStatus.merge_in_progress
      && releaseStatus?.can_publish
      && releaseStatus.latest_release,
  );
}

function ReleaseBlockers({ blockers, title }: { blockers: ReleaseBlocker[]; title: string }) {
  if (blockers.length === 0) return null;
  return (
    <div className="release-blockers">
      <Text size={200} weight="semibold">{title}</Text>
      {blockers.map((blocker) => (
        <Text size={200} key={`${title}-${blocker.code}`}>{blocker.message}</Text>
      ))}
    </div>
  );
}

function validBranchOrFallback(current: string, branches: string[], activeBranch?: string | null) {
  if (current && branches.includes(current)) return current;
  return activeBranch || branches[0] || '';
}

export function validIntegrationBranchOrFallback(
  current: string,
  candidates: BranchIntegrationCandidate[],
) {
  const integrableBranches = candidates
    .filter((candidate) => candidate.integrable)
    .map((candidate) => candidate.name);
  if (current && integrableBranches.includes(current)) return current;
  return integrableBranches[0] || '';
}

const gitGraphTemplate = templateExtend(TemplateName.Metro, {
  colors: ['#25636d', '#7a4f9e', '#b85c00', '#4b7f52', '#9b5c64', '#5579a6'],
  branch: {
    lineWidth: 3,
    mergeStyle: MergeStyle.Straight,
    spacing: 42,
    label: {
      display: true,
      font: 'normal 10pt Segoe UI',
    },
  },
  commit: {
    spacing: 40,
    dot: {
      size: 7,
    },
    message: {
      displayHash: false,
      displayAuthor: false,
      font: 'normal 10pt Segoe UI',
    },
  },
});

function GitGraphView({ graph }: { graph: GitGraphData | null }) {
  const graphKey = graph?.commits.map((commit) => commit.hash).join(':') || 'empty';

  return (
    <div className="card git-graph-card">
      <div className="git-graph-header">
        <Text weight="semibold">Recent History</Text>
        {graph?.truncated ? <span className="audit-pill">Limited to {graph.limit}</span> : null}
      </div>
      {graph && graph.commits.length > 0 ? (
        <div className="git-graph-scroll">
          <Gitgraph
            key={graphKey}
            options={{
              mode: Mode.Compact,
              orientation: Orientation.VerticalReverse,
              template: gitGraphTemplate,
            }}
          >
            {(gitgraph) => {
              gitgraph.import(graph.commits);
            }}
          </Gitgraph>
        </div>
      ) : (
        <Text size={200}>No graph history yet.</Text>
      )}
    </div>
  );
}

export function DiagnosticsPanel() {
  const diagnostics = useAppStore((s) => s.diagnostics);
  const setDiagnostics = useAppStore((s) => s.setDiagnostics);

  async function run(options: { silent?: boolean } = {}) {
    try {
      const nextDiagnostics = await api.diagnostics.run();
      setDiagnostics(nextDiagnostics);
      if (!options.silent) {
        const errorCount = nextDiagnostics.filter((item) => item.severity === 'error').length;
        const warningCount = nextDiagnostics.filter((item) => item.severity === 'warning').length;
        notify[errorCount || warningCount ? 'warning' : 'success']({
          intent: 'diagnostics.completed',
          title: 'Diagnostics completed',
          body: errorCount || warningCount
            ? `${errorCount} errors and ${warningCount} warnings found.`
            : 'No diagnostics reported.',
          source: 'diagnostics',
          dedupeKey: 'diagnostics.run',
          action: { label: 'Open diagnostics', panelId: 'diagnostics' },
        });
      }
    } catch (error) {
      notify.error({
        intent: 'operation.failed',
        title: 'Could not run diagnostics',
        body: errorMessage(error),
        source: 'diagnostics',
        dedupeKey: 'diagnostics.run',
        action: { label: 'Open diagnostics', panelId: 'diagnostics' },
      });
    }
  }

  useEffect(() => { void run({ silent: true }); }, []);

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

  async function refresh() {
    try {
      setEvents(await api.audit.recent());
      setExpandedKey(null);
    } catch (error) {
      notify.error({
        intent: 'operation.failed',
        title: 'Could not refresh audit events',
        body: errorMessage(error),
        source: 'diagnostics',
        dedupeKey: 'audit.refresh',
        action: { label: 'Open audit', panelId: 'audit' },
      });
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
