import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Text,
} from '@fluentui/react-components';
import { Gitgraph, MergeStyle, Orientation, TemplateName, templateExtend } from '@gitgraph/react';
import type { MouseEvent } from 'react';
import { useEffect, useState } from 'react';
import { api } from '../api/bridge';
import type {
  AuditEvent,
  BranchIntegrationCandidate,
  CapabilityMapAlignment,
  CapabilityMapColorScheme,
  CapabilityMapLayoutDensity,
  Checkpoint,
  GitGraphData,
  GitStatus,
  ImportMode,
  ImportPreview,
  ModelFormat,
  ReleaseBlocker,
  ReleaseStatus,
  RepositorySettingsPatch,
} from '../api/types';
import {
  CAPABILITY_MAP_ALIGNMENT_OPTIONS,
  CAPABILITY_MAP_LAYOUT_DENSITY_OPTIONS,
  CAPABILITY_MAP_RATIO_PRESETS,
  DEFAULT_CAPABILITY_MAP_ALIGNMENT,
  DEFAULT_CAPABILITY_MAP_LAYOUT_DENSITY,
  DEFAULT_CAPABILITY_MAP_TARGET_ASPECT_RATIO,
} from '../capability-map-settings';
import { errorMessage, notify } from '../notifications/notify';
import { useAppStore } from '../store/app-store';
import { useSettingsStore } from '../store/settings-store';
import type { BlockingTaskOptions } from '../tasks/blocking-task-store';
import { blockingTask } from '../tasks/blocking-task-store';
import { gitBlockingTaskOptions } from '../tasks/git-blocking-tasks';
import {
  refreshWorkspaceViews,
  runWorkspaceRefreshTask,
  workspaceDetails,
  workspaceRefreshTaskOptions,
} from '../workspace/workspace-refresh';
import { DEFAULT_CAPABILITY_MAP_COLOR_SCHEME } from './capability-map-layout';
import { GitBadges } from './GitBadges';

const CUSTOM_RATIO_VALUE = 'custom';

export function WorkspacePanel() {
  const workspace = useAppStore((s) => s.workspace);
  const settings = useSettingsStore((s) => s.settings);
  const [path, setPath] = useState(workspace?.path ?? '');
  const [name, setName] = useState('ECM Workspace');
  const [advanced, setAdvanced] = useState(false);

  async function open(openPath?: string) {
    const targetPath = openPath ?? (path || undefined);
    try {
      const { snapshot } = await runWorkspaceRefreshTask(
        async () => api.workspace.open(targetPath),
        workspaceRefreshTaskOptions('open', workspaceDetails(targetPath)),
      );
      const opened = snapshot.workspace;
      setPath(opened.path);
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
      const pickedPath = await api.workspace.pickFolder();
      if (!pickedPath) return;
      await open(pickedPath);
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
      const pickedPath = await api.workspace.pickFolder();
      if (!pickedPath) return;
      await init(pickedPath);
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

  async function init(initPath = path) {
    try {
      const { snapshot } = await runWorkspaceRefreshTask(
        async () => api.workspace.init(initPath, name),
        workspaceRefreshTaskOptions('init', workspaceDetails(initPath)),
      );
      const initialized = snapshot.workspace;
      setPath(initialized.path);
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
        dedupeKey: `workspace.create.${initPath}`,
        action: { label: 'Open workspace', panelId: 'workspace' },
      });
    }
  }

  async function rebuild() {
    try {
      await runWorkspaceRefreshTask(
        async () => api.workspace.rebuildIndex(),
        workspaceRefreshTaskOptions('rebuild', workspaceDetails(workspace?.path)),
      );
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
        <Button appearance="primary" onClick={() => void pickOpen()}>
          Open Workspace
        </Button>
        <Button onClick={() => void pickInit()}>Create Workspace</Button>
        <Button disabled={!workspace} onClick={() => void rebuild()}>
          Rebuild Index
        </Button>
      </div>

      {settings.recent_workspaces.length ? (
        <div className="stack compact">
          <Text size={200} weight="semibold">
            Recent Workspaces
          </Text>
          {settings.recent_workspaces.map((recent) => (
            <button
              className="link-card"
              key={recent}
              onClick={() => void open(recent)}
              type="button"
            >
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
          <Input
            value={path}
            onChange={(_, d) => setPath(d.value)}
            placeholder="C:\\path\\to\\repo"
          />
          <div className="toolbar">
            <Button appearance="primary" onClick={() => void init()}>
              Initialize Path
            </Button>
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
      ) : (
        <Text>No workspace open.</Text>
      )}
    </section>
  );
}

export function RepositorySettingsPanel() {
  const workspace = useAppStore((s) => s.workspace);
  const setWorkspace = useAppStore((s) => s.setWorkspace);
  const savedSettings = workspace?.settings.capability_map;
  const savedRatio =
    savedSettings?.target_aspect_ratio ?? DEFAULT_CAPABILITY_MAP_TARGET_ASPECT_RATIO;
  const savedRatioPresetValue = matchingRatioPresetValue(savedRatio);
  const savedLayoutDensity = savedSettings?.layout_density ?? DEFAULT_CAPABILITY_MAP_LAYOUT_DENSITY;
  const savedAlignment = savedSettings?.alignment ?? DEFAULT_CAPABILITY_MAP_ALIGNMENT;
  const savedColorScheme = savedSettings?.color_scheme ?? DEFAULT_CAPABILITY_MAP_COLOR_SCHEME;
  const [ratioPresetValue, setRatioPresetValue] = useState(savedRatioPresetValue);
  const [layoutDensity, setLayoutDensity] =
    useState<CapabilityMapLayoutDensity>(savedLayoutDensity);
  const [alignment, setAlignment] = useState<CapabilityMapAlignment>(savedAlignment);
  const [colorScheme, setColorScheme] = useState<CapabilityMapColorScheme>(() =>
    cloneCapabilityMapColorScheme(savedColorScheme),
  );

  useEffect(() => {
    setRatioPresetValue(savedRatioPresetValue);
    setLayoutDensity(savedLayoutDensity);
    setAlignment(savedAlignment);
    setColorScheme(cloneCapabilityMapColorScheme(savedColorScheme));
  }, [
    savedRatioPresetValue,
    savedLayoutDensity,
    savedAlignment,
    savedColorScheme,
    workspace?.path,
  ]);

  const selectedRatio =
    ratioPresetValue === CUSTOM_RATIO_VALUE ? savedRatio : Number(ratioPresetValue);
  const ratioDirty =
    ratioPresetValue !== CUSTOM_RATIO_VALUE && Math.abs(selectedRatio - savedRatio) > 0.000001;
  const layoutDirty = layoutDensity !== savedLayoutDensity || alignment !== savedAlignment;
  const colorDirty = !sameCapabilityMapColorScheme(colorScheme, savedColorScheme);
  const dirty = ratioDirty || layoutDirty || colorDirty;

  async function saveRepositorySettings() {
    if (!workspace) return;
    const patch: RepositorySettingsPatch = {
      capability_map: {
        target_aspect_ratio: selectedRatio,
        layout_density: layoutDensity,
        alignment,
        color_scheme: cloneCapabilityMapColorScheme(colorScheme),
      },
    };
    try {
      const updated = await api.workspace.updateSettings(patch);
      setWorkspace(updated);
      notify.success({
        intent: 'workspace.settings.updated',
        title: 'Repository settings saved',
        body: workspace.name,
        source: 'workspace',
        dedupeKey: `workspace.settings.${workspace.path}`,
        action: { label: 'Open repository settings', panelId: 'repository_settings' },
      });
    } catch (error) {
      notify.error({
        intent: 'operation.failed',
        title: 'Could not save repository settings',
        body: errorMessage(error),
        source: 'workspace',
        dedupeKey: `workspace.settings.${workspace.path}`,
        action: { label: 'Open repository settings', panelId: 'repository_settings' },
      });
    }
  }

  return (
    <section className="panel stack repository-settings-panel">
      <Text weight="semibold">Repository Settings</Text>
      {!workspace ? <Text>Open or initialize a workspace first.</Text> : null}

      <div className="card repository-settings-card">
        <Text weight="semibold">Capability Map</Text>
        <label className="field-label">
          Target aspect ratio preset
          <select
            className="select"
            disabled={!workspace}
            value={ratioPresetValue}
            onChange={(event) => setRatioPresetValue(event.target.value)}
          >
            {CAPABILITY_MAP_RATIO_PRESETS.map((preset) => (
              <option key={preset.label} value={String(preset.value)}>
                {preset.label}
              </option>
            ))}
            {ratioPresetValue === CUSTOM_RATIO_VALUE ? (
              <option value={CUSTOM_RATIO_VALUE}>Custom</option>
            ) : null}
          </select>
        </label>
        <label className="field-label">
          Layout density
          <select
            className="select"
            disabled={!workspace}
            value={layoutDensity}
            onChange={(event) => setLayoutDensity(event.target.value as CapabilityMapLayoutDensity)}
          >
            {CAPABILITY_MAP_LAYOUT_DENSITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Alignment
          <select
            className="select"
            disabled={!workspace}
            value={alignment}
            onChange={(event) => setAlignment(event.target.value as CapabilityMapAlignment)}
          >
            {CAPABILITY_MAP_ALIGNMENT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="settings-color-section">
          <Text size={200} weight="semibold">
            Capability colors
          </Text>
          <div className="color-settings-grid">
            {colorScheme.depth_colors.map((color, index) => (
              <label className="color-swatch-field" key={`depth-${index}`}>
                <span>Depth {index}</span>
                <input
                  aria-label={`Capability map depth ${index} color`}
                  className="color-input"
                  disabled={!workspace}
                  onChange={(event) =>
                    setColorScheme((current) =>
                      updateDepthColor(current, index, event.target.value),
                    )
                  }
                  type="color"
                  value={colorInputValue(color)}
                />
                <span className="color-value">{formatColor(color)}</span>
              </label>
            ))}
            <label className="color-swatch-field">
              <span>Leaf</span>
              <input
                aria-label="Capability map leaf color"
                className="color-input"
                disabled={!workspace}
                onChange={(event) =>
                  setColorScheme((current) => ({
                    ...current,
                    leaf_color: event.target.value,
                  }))
                }
                type="color"
                value={colorInputValue(colorScheme.leaf_color)}
              />
              <span className="color-value">{formatColor(colorScheme.leaf_color)}</span>
            </label>
          </div>
        </div>

        <div className="toolbar">
          <Button
            appearance="primary"
            disabled={!workspace || !dirty}
            onClick={() => void saveRepositorySettings()}
          >
            Save
          </Button>
          <Button
            disabled={
              !workspace ||
              sameCapabilityMapColorScheme(colorScheme, DEFAULT_CAPABILITY_MAP_COLOR_SCHEME)
            }
            onClick={() =>
              setColorScheme(cloneCapabilityMapColorScheme(DEFAULT_CAPABILITY_MAP_COLOR_SCHEME))
            }
          >
            Reset colors
          </Button>
        </div>
      </div>
    </section>
  );
}

function matchingRatioPresetValue(value: number): string {
  const match = CAPABILITY_MAP_RATIO_PRESETS.find(
    (preset) => Math.abs(preset.value - value) <= 0.000001,
  );
  return match ? String(match.value) : CUSTOM_RATIO_VALUE;
}

function cloneCapabilityMapColorScheme(
  colorScheme: CapabilityMapColorScheme,
): CapabilityMapColorScheme {
  return {
    depth_colors: [...colorScheme.depth_colors],
    leaf_color: colorScheme.leaf_color,
  };
}

function updateDepthColor(
  colorScheme: CapabilityMapColorScheme,
  index: number,
  color: string,
): CapabilityMapColorScheme {
  return {
    ...colorScheme,
    depth_colors: colorScheme.depth_colors.map((current, currentIndex) =>
      currentIndex === index ? color : current,
    ),
  };
}

function sameCapabilityMapColorScheme(
  left: CapabilityMapColorScheme,
  right: CapabilityMapColorScheme,
): boolean {
  return (
    left.leaf_color.toLowerCase() === right.leaf_color.toLowerCase() &&
    left.depth_colors.length === right.depth_colors.length &&
    left.depth_colors.every(
      (color, index) => color.toLowerCase() === right.depth_colors[index]?.toLowerCase(),
    )
  );
}

function colorInputValue(color: string): string {
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : '#000000';
}

function formatColor(color: string): string {
  return color.toUpperCase();
}

export function ImportExportPanel() {
  const workspace = useAppStore((s) => s.workspace);
  const [format, setFormat] = useState<ModelFormat>('jsonl');
  const [mode, setMode] = useState<ImportMode>('append');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);

  useEffect(() => {
    setPreview(null);
  }, [mode, workspace?.path]);

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
      const { result } = await runWorkspaceRefreshTask(
        async () => api.models.importApply(preview.source_path, preview.mode),
        workspaceRefreshTaskOptions('importApply', `Source: ${preview.source_path}`),
      );
      setPreview(result);
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
        <select
          className="select"
          value={format}
          onChange={(event) => setFormat(event.target.value as ModelFormat)}
        >
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
        <select
          className="select"
          value={mode}
          onChange={(event) => setMode(event.target.value as ImportMode)}
        >
          <option value="append">Append new capabilities</option>
          <option value="replace">Replace current model</option>
          <option value="merge_by_id">Merge by ID</option>
          <option value="validate_only">Validate only</option>
        </select>
        <Button disabled={!workspace} onClick={() => void previewImport()}>
          Choose File + Preview
        </Button>
        <Button disabled={!canApplyImportPreview(preview)} onClick={() => void applyImport()}>
          Apply Import
        </Button>
      </div>

      {preview ? (
        <div className="card">
          <Text weight="semibold">Preview: {preview.source_path}</Text>
          <Text size={200}>
            Format {preview.format}, mode {preview.mode}
          </Text>
          <div className="metric-row">
            <span>Total {preview.total}</span>
            <span>Added {preview.added}</span>
            <span>Updated {preview.updated}</span>
            <span>Skipped {preview.skipped}</span>
            <span>Invalid {preview.invalid}</span>
          </div>
          {preview.checkpoint_id ? (
            <Text size={200}>Checkpoint: {preview.checkpoint_id.slice(0, 10)}</Text>
          ) : null}
          {preview.diagnostics.map((item, index) => (
            <div key={`${item.code}-${index}`} className={`card ${item.severity}`}>
              <Text weight="semibold">{item.code}</Text>
              <Text>{item.message}</Text>
              {item.path ? (
                <Text size={200}>
                  {item.path}
                  {item.line ? `:${item.line}` : ''}
                </Text>
              ) : null}
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
  const workspace = useAppStore((s) => s.workspace);
  const gitStatus = useAppStore((s) => s.gitStatus);
  const integrationCandidates = useAppStore((s) => s.integrationCandidates);
  const releaseStatus = useAppStore((s) => s.releaseStatus);
  const history = useAppStore((s) => s.gitHistory);
  const graph = useAppStore((s) => s.gitGraph);
  const [message, setMessage] = useState('ECM checkpoint');
  const [branchName, setBranchName] = useState('work/new-capability-model');
  const [contextBranch, setContextBranch] = useState('');
  const [integrationBranch, setIntegrationBranch] = useState('');
  const [releaseVersion, setReleaseVersion] = useState('0.1.0');
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [restoreCheckpointTarget, setRestoreCheckpointTarget] = useState<Checkpoint | null>(null);

  async function refresh() {
    try {
      await refreshWorkspaceViews();
    } catch (error) {
      notify.error({
        intent: 'operation.failed',
        title: 'Could not refresh workspace state',
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
      intent:
        | 'git.checkpoint.created'
        | 'git.branch.created'
        | 'git.branch.switched'
        | 'git.pull.completed'
        | 'git.merge.completed'
        | 'git.merge.aborted'
        | 'git.restore.completed'
        | 'git.discard.completed'
        | 'release.cut'
        | 'release.published';
      title: string;
      body?: string | ((result: T) => string | undefined);
      source?: 'git' | 'release';
      dedupeKey: string;
    },
    errorTitle: string,
    task: BlockingTaskOptions,
  ) {
    try {
      const result = await blockingTask.run(async () => {
        const nextResult = await action();
        await refreshWorkspaceViews();
        return nextResult;
      }, task);
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
      gitBlockingTaskOptions('checkpoint', `Branch: ${branch}`),
    );
  }

  async function restoreCheckpoint(checkpointToRestore: Checkpoint) {
    const branch = gitStatus?.branch ?? 'current';
    await runGitOperation(
      () => api.git.restore(checkpointToRestore.id, false),
      {
        intent: 'git.restore.completed',
        title: 'Checkpoint reverted',
        body: `${checkpointToRestore.message} (${checkpointToRestore.id.slice(0, 10)})`,
        dedupeKey: `git.restore.${checkpointToRestore.id}`,
      },
      'Could not revert checkpoint',
      gitBlockingTaskOptions(
        'restoreCheckpoint',
        `Branch: ${branch}\nCheckpoint: ${checkpointToRestore.id.slice(0, 10)}`,
      ),
    );
    setRestoreCheckpointTarget(null);
  }

  async function discardPendingChanges() {
    const branch = gitStatus?.branch ?? 'current';
    await runGitOperation(
      () => api.git.discardPendingChanges(),
      {
        intent: 'git.discard.completed',
        title: 'Pending changes discarded',
        body: (result) =>
          `${result.reverted_files.length} reverted, ${result.deleted_files.length} deleted.`,
        dedupeKey: `git.discard.${branch}`,
      },
      'Could not discard pending changes',
      gitBlockingTaskOptions('discardPendingChanges', `Branch: ${branch}`),
    );
    setDiscardDialogOpen(false);
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
      gitBlockingTaskOptions('createBranch', `Scenario: ${branchName}`),
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
      gitBlockingTaskOptions('switchBranch', `Scenario: ${contextBranch}`),
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
      gitBlockingTaskOptions('pull', `Branch: ${branch}`),
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
      gitBlockingTaskOptions('mergeBranch', `Source: ${integrationBranch}\nTarget: ${target}`),
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
      gitBlockingTaskOptions('abortMerge', `Branch: ${branch}`),
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
      gitBlockingTaskOptions(
        'cutRelease',
        `Version: ${releaseVersion}\nTag: ${releaseTagForVersion(releaseVersion)}`,
      ),
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
      gitBlockingTaskOptions('publishRelease', `Tag: ${tag}`),
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

  const branches = gitStatus?.branches ?? [];
  const branchKey = branches.join('\u0000');
  const candidateKey = integrationCandidates
    .map((candidate) => `${candidate.name}:${candidate.integrable}`)
    .join('\u0000');

  useEffect(() => {
    if (!workspace) return;
    setContextBranch((current) => validBranchOrFallback(current, branches, gitStatus?.branch));
    setIntegrationBranch((current) =>
      validIntegrationBranchOrFallback(current, integrationCandidates),
    );
  }, [workspace?.path, gitStatus?.branch, branchKey, candidateKey]);

  const clean = gitStatus?.clean ?? false;
  const isRepo = gitStatus?.is_repo ?? false;
  const mergeInProgress = gitStatus?.merge_in_progress ?? false;
  const canRisk = isRepo && clean && !mergeInProgress;
  const integrableBranches = integrationCandidates
    .filter((candidate) => candidate.integrable)
    .map((candidate) => candidate.name);
  const pendingCount =
    (gitStatus?.changed_files?.length ?? 0) + (gitStatus?.untracked_files?.length ?? 0);
  const pendingFiles = [
    ...(gitStatus?.changed_files ?? []).map((path) => ({ path, kind: 'Tracked' })),
    ...(gitStatus?.untracked_files ?? []).map((path) => ({ path, kind: 'Untracked' })),
  ];
  const releaseTag = releaseTagForVersion(releaseVersion);
  const canCut = canCutRelease(releaseStatus, gitStatus, releaseVersion);
  const canPublish = canPublishRelease(releaseStatus, gitStatus);
  const remoteLabel = releaseStatus?.remote?.is_github
    ? `${releaseStatus.remote.host}/${releaseStatus.remote.owner}/${releaseStatus.remote.repo}`
    : gitStatus?.has_remote
      ? (gitStatus.upstream ?? 'Remote configured')
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
          {(gitStatus?.conflicted_files ?? []).map((file) => (
            <Text key={file}>{file}</Text>
          ))}
          <Button appearance="primary" onClick={() => void abortMerge()}>
            Abort Integration
          </Button>
        </div>
      ) : null}

      <div className="workflow-grid">
        <div className="card workflow-card">
          <Text weight="semibold">Checkpoint</Text>
          <Text size={200}>
            {pendingCount ? `${pendingCount} pending file changes.` : 'No pending file changes.'}
          </Text>
          <Input
            value={message}
            onChange={(_, d) => setMessage(d.value)}
            aria-label="Checkpoint message"
          />
          <div className="toolbar">
            <Button
              disabled={!isRepo || mergeInProgress}
              appearance="primary"
              onClick={() => void checkpoint()}
            >
              Create Checkpoint
            </Button>
            <Button
              disabled={!isRepo || mergeInProgress || pendingFiles.length === 0}
              onClick={() => setDiscardDialogOpen(true)}
            >
              Discard Pending Changes
            </Button>
          </div>
        </div>

        <div className="card workflow-card">
          <Text weight="semibold">New Scenario</Text>
          <Text size={200}>Starts from {gitStatus?.branch ?? 'the current scenario'}.</Text>
          <Input
            value={branchName}
            onChange={(_, d) => setBranchName(d.value)}
            aria-label="Scenario name"
          />
          <Button disabled={!canRisk} onClick={() => void createBranch()}>
            Create Scenario
          </Button>
        </div>

        <div className="card workflow-card">
          <Text weight="semibold">Change Scenario</Text>
          <Text size={200}>Open another scenario for editing.</Text>
          <select
            className="select"
            value={contextBranch}
            onChange={(event) => setContextBranch(event.target.value)}
          >
            {branches.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
          <Button
            disabled={!canRisk || !contextBranch || contextBranch === gitStatus?.branch}
            onClick={() => void switchBranch()}
          >
            Change Scenario
          </Button>
        </div>

        <div className="card workflow-card">
          <Text weight="semibold">Integrate Scenario</Text>
          <Text size={200}>
            Bring another scenario into {gitStatus?.branch ?? 'the current scenario'}.
          </Text>
          <select
            className="select"
            value={integrationBranch}
            onChange={(event) => setIntegrationBranch(event.target.value)}
          >
            {integrableBranches.length ? (
              integrableBranches.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))
            ) : (
              <option value="">No scenarios with pending integration</option>
            )}
          </select>
          <Button
            disabled={
              !canRisk || !integrationBranch || !integrableBranches.includes(integrationBranch)
            }
            onClick={() => void mergeBranch()}
          >
            Integrate Into Current
          </Button>
        </div>

        <div className="card workflow-card">
          <Text weight="semibold">Release</Text>
          <Text size={200}>{remoteLabel}</Text>
          <Text size={200}>
            Outgoing {gitStatus?.ahead ?? 0}; incoming {gitStatus?.behind ?? 0}
          </Text>
          <label className="field-label">
            Version
            <Input
              value={releaseVersion}
              onChange={(_, d) => setReleaseVersion(d.value)}
              aria-label="Release version"
            />
          </label>
          <Text size={200}>Tag {releaseTag}</Text>
          {releaseStatus?.latest_release ? (
            <Text size={200}>
              Latest {releaseStatus.latest_release.tag} ({releaseStatus.latest_release.state})
            </Text>
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
          <ReleaseBlockers
            blockers={releaseStatus?.publish_blockers ?? []}
            title="Publish blocked"
          />
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
            <div key={item.id || item.message} className="card checkpoint-card">
              <div className="checkpoint-card-main">
                <Text weight="semibold">{item.message}</Text>
                <Text size={200}>
                  {item.id.slice(0, 10)} {item.timestamp}
                </Text>
              </div>
              <Button disabled={!item.id} onClick={() => setRestoreCheckpointTarget(item)}>
                Revert
              </Button>
            </div>
          ))}
          {history.length === 0 ? <Text size={200}>No checkpoints yet.</Text> : null}
        </div>
      </details>
      <Dialog open={discardDialogOpen} onOpenChange={(_, data) => setDiscardDialogOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Discard Pending Changes</DialogTitle>
            <DialogContent className="confirmation-dialog-content">
              <Text>
                This will revert tracked files and delete untracked files from the workspace.
              </Text>
              <PendingFileList files={pendingFiles} />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDiscardDialogOpen(false)}>Cancel</Button>
              <Button
                appearance="primary"
                disabled={pendingFiles.length === 0}
                onClick={() => void discardPendingChanges()}
              >
                Discard Changes
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <Dialog
        open={restoreCheckpointTarget !== null}
        onOpenChange={(_, data) => {
          if (!data.open) setRestoreCheckpointTarget(null);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Revert Checkpoint</DialogTitle>
            <DialogContent className="confirmation-dialog-content">
              <Text>
                This will restore ECM model files from the selected checkpoint. Pending changes must
                be discarded or checkpointed first.
              </Text>
              {restoreCheckpointTarget ? (
                <div className="checkpoint-confirmation">
                  <Text weight="semibold">{restoreCheckpointTarget.message}</Text>
                  <Text size={200}>
                    {restoreCheckpointTarget.id.slice(0, 10)} {restoreCheckpointTarget.timestamp}
                  </Text>
                </div>
              ) : null}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setRestoreCheckpointTarget(null)}>Cancel</Button>
              <Button
                appearance="primary"
                disabled={!restoreCheckpointTarget?.id}
                onClick={() => {
                  if (restoreCheckpointTarget) void restoreCheckpoint(restoreCheckpointTarget);
                }}
              >
                Revert
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
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
    gitStatus?.is_repo &&
      gitStatus.clean &&
      gitStatus.has_remote &&
      !gitStatus.merge_in_progress &&
      releaseStatus?.can_cut &&
      releaseTagForVersion(version) !== 'ecm-vX.Y.Z',
  );
}

export function canPublishRelease(
  releaseStatus: ReleaseStatus | null | undefined,
  gitStatus: GitStatus | null | undefined,
): boolean {
  return Boolean(
    gitStatus?.is_repo &&
      gitStatus.clean &&
      gitStatus.has_remote &&
      !gitStatus.merge_in_progress &&
      releaseStatus?.can_publish &&
      releaseStatus.latest_release,
  );
}

function ReleaseBlockers({ blockers, title }: { blockers: ReleaseBlocker[]; title: string }) {
  if (blockers.length === 0) return null;
  return (
    <div className="release-blockers">
      <Text size={200} weight="semibold">
        {title}
      </Text>
      {blockers.map((blocker) => (
        <Text size={200} key={`${title}-${blocker.code}`}>
          {blocker.message}
        </Text>
      ))}
    </div>
  );
}

function PendingFileList({ files }: { files: { path: string; kind: string }[] }) {
  if (files.length === 0) return <Text size={200}>No pending file changes.</Text>;
  return (
    <ul className="pending-file-list">
      {files.map((file) => (
        <li key={`${file.kind}-${file.path}`}>
          <span>{file.kind}</span>
          <code>{file.path}</code>
        </li>
      ))}
    </ul>
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
          body:
            errorCount || warningCount
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

  return (
    <section className="panel stack">
      <div className="toolbar">
        <Text weight="semibold">Diagnostics</Text>
        <Button onClick={() => void run()}>Run</Button>
      </div>
      {diagnostics.length === 0 ? (
        <Text>No diagnostics.</Text>
      ) : (
        diagnostics.map((item, index) => (
          <div key={`${item.code}-${index}`} className={`card ${item.severity}`}>
            <Text weight="semibold">{item.code}</Text>
            <Text>{item.message}</Text>
            {item.path ? (
              <Text size={200}>
                {item.path}
                {item.line ? `:${item.line}` : ''}
              </Text>
            ) : null}
          </div>
        ))
      )}
    </section>
  );
}

export function AuditPanel() {
  const workspace = useAppStore((s) => s.workspace);
  const events = useAppStore((s) => s.auditEvents);
  const setAuditEvents = useAppStore((s) => s.setAuditEvents);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  async function refresh() {
    try {
      setAuditEvents(await api.audit.recent());
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

  useEffect(() => {
    setExpandedKey(null);
  }, [workspace?.path, events]);

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
              setExpandedKey((current) => (current === key ? null : key));
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
  const timestamp =
    auditField(record, 'created_at') ?? auditField(record, 'updated_at') ?? 'No timestamp';
  const target = auditTarget(record);
  const actor = auditField(record, 'actor');
  const detailPayload = event.error ?? record ?? {};

  return (
    <article className={`audit-item ${event.error ? 'error' : ''}`}>
      <div className="audit-row">
        <div className="audit-action-mark" aria-hidden="true">
          {action.slice(0, 1).toUpperCase()}
        </div>
        <div className="audit-summary">
          <div className="audit-title-row">
            <Text weight="semibold">{title}</Text>
            <span className="audit-pill">{action}</span>
          </div>
          <div className="audit-meta-row">
            <span>{timestamp}</span>
            {target ? <span>{target}</span> : null}
            {actor ? <span>Actor: {actor}</span> : null}
            <span>
              {event.source}:{event.line}
            </span>
          </div>
        </div>
        <Button appearance="subtle" onClick={onToggle}>
          {expanded ? 'Hide Details' : 'Details'}
        </Button>
      </div>
      {expanded ? (
        <div className="audit-details">
          <div className="audit-detail-grid">
            <span>Source</span>
            <strong>
              {event.source}:{event.line}
            </strong>
            <span>Action</span>
            <strong>{action}</strong>
            <span>Target</span>
            <strong>{target || 'n/a'}</strong>
            <span>Timestamp</span>
            <strong>{timestamp}</strong>
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
