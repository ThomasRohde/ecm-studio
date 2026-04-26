export type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; detail?: unknown } };

export interface AppInfo {
  name: string;
  version: string;
}

export interface Workspace {
  path: string;
  name: string;
  initialized: boolean;
  index_current: boolean;
  rebuild?: { capability_count: number; source_hash: string } | null;
  git: GitStatus;
}

export interface GitStatus {
  is_repo: boolean;
  clean: boolean;
  changed_files: string[];
  untracked_files: string[];
  conflicted_files: string[];
  branch?: string | null;
  branches: string[];
  has_remote: boolean;
  upstream?: string | null;
  ahead: number;
  behind: number;
  merge_in_progress: boolean;
}

export interface BranchIntegrationCandidate {
  name: string;
  integrable: boolean;
}

export interface ReleaseBlocker {
  code: string;
  message: string;
}

export interface GitHubRemoteStatus {
  name: string;
  url: string;
  host: string | null;
  owner: string | null;
  repo: string | null;
  is_github: boolean;
}

export interface GitHubCliStatus {
  available: boolean;
  authenticated: boolean;
  message?: string | null;
}

export interface ReleaseSummary {
  id: string;
  version_label: string;
  tag: string;
  state: string;
  capability_count: number;
  export_paths: string[];
  released_at: string;
  checkpoint_id?: string | null;
  published_at?: string;
  github_release_url?: string;
  delivery_status?: string;
}

export interface ReleaseStatus {
  can_cut: boolean;
  can_publish: boolean;
  cut_blockers: ReleaseBlocker[];
  publish_blockers: ReleaseBlocker[];
  remote: GitHubRemoteStatus | null;
  github_cli: GitHubCliStatus;
  latest_release: ReleaseSummary | null;
}

export interface ReleaseResult {
  version_label: string;
  tag: string;
  checkpoint_id: string;
  model_version_id: string;
  export_paths: string[];
  released_at: string;
}

export interface PublishResult {
  tag: string;
  github_release_url: string;
  publish_event_id: string;
  checkpoint_id: string;
  published_at: string;
  pushed: { pushed: boolean; remote: string; branch: string };
}

export interface GitGraphAuthor {
  name: string;
  email: string;
  timestamp: number;
}

export interface GitGraphCommit {
  hash: string;
  parents: string[];
  subject: string;
  body: string;
  author: GitGraphAuthor;
  refs: string[];
}

export interface GitGraphData {
  commits: GitGraphCommit[];
  current_branch?: string | null;
  limit: number;
  truncated: boolean;
}

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export interface AppSettings {
  schema_version: '1.0';
  theme_mode: ThemeMode;
  resolved_theme: ResolvedTheme;
  recent_workspaces: string[];
}

export interface Capability {
  _t: 'capability';
  schema_version: '1.0';
  id: string;
  name: string;
  aliases: string[];
  description: string;
  domain: string;
  type: 'abstract' | 'leaf';
  parent_id: string | null;
  order: number;
  lifecycle_status: 'Draft' | 'Active' | 'Deprecated' | 'Retired';
  effective_from: string | null;
  effective_to: string | null;
  rationale: string;
  source_references: string[];
  tags: string[];
  steward_id: string;
  steward_department: string;
  created_at: string;
  updated_at: string;
  children?: Capability[];
}

export type CapabilityPatch = Pick<
  Capability,
  | 'name'
  | 'aliases'
  | 'description'
  | 'domain'
  | 'lifecycle_status'
  | 'effective_from'
  | 'effective_to'
  | 'rationale'
  | 'source_references'
  | 'tags'
  | 'steward_id'
  | 'steward_department'
>;

export interface SearchResult {
  id: string;
  name: string;
  path: string;
  parent_id: string | null;
  domain: string;
  tags: string;
  steward_id: string;
}

export interface Checkpoint {
  id: string;
  message: string;
  timestamp: string;
  author: string;
  skipped: boolean;
}

export interface Diagnostic {
  code: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  path?: string | null;
  line?: number | null;
}

export type ModelFormat = 'jsonl' | 'csv' | 'json_bundle';
export type MapExportFormat = 'svg' | 'html';
export type ImportMode = 'validate_only' | 'append' | 'replace' | 'merge_by_id';

export interface ImportPreview {
  source_path: string;
  format: ModelFormat;
  mode: ImportMode;
  total: number;
  added: number;
  updated: number;
  skipped: number;
  invalid: number;
  diagnostics: Diagnostic[];
  applied: boolean;
  checkpoint_id?: string | null;
  rebuild?: { capability_count: number; source_hash: string };
}

export interface ExportResult {
  format: ModelFormat;
  path: string;
  count: number;
}

export interface MapExportResult {
  format: MapExportFormat;
  path: string;
}

export interface AuditEvent {
  source: string;
  line: number;
  record?: Record<string, unknown>;
  error?: { line: number; message: string };
}
