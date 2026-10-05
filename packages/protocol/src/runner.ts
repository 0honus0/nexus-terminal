/** Backend/Runner wire contracts. Durable records and authorization remain local. */
export type WorkspaceKind = 'shell' | 'code' | 'data' | 'browser';
export type WorkspaceStatus = 'creating' | 'ready' | 'running' | 'stopped' | 'deleted' | 'failed';

export interface PluginRunnerTarget {
  pluginId: string;
  version: string;
  sdkVersion: string;
  protocolVersion: 3;
  packageHash: string;
  entry: string;
}
export interface ToolchainPackRef {
  familyId: string;
  versionId: string;
}
export interface WorkspaceRecipe {
  id: string;
  revision: string;
  kind: WorkspaceKind;
  displayName: string;
  allowedFamilies: string[];
  defaultFamilies: string[];
}
export interface WorkspaceAcpProfile {
  id: string;
  profileRevision: number;
  argv: string[];
  cwd: string;
}
export interface WorkspaceBrowserEndpoint {
  scope: 'docker-network' | 'external-network';
  via: 'backend' | 'runner';
  url: string;
  priority: number;
  allowPlaintext: boolean;
  verifyTls: boolean;
}
export interface WorkspaceBrowserTarget {
  id: string;
  profileRevision: number;
  endpoints: WorkspaceBrowserEndpoint[];
  allowedUrlPatterns: string[];
}
interface WorkspaceCommandBase {
  commandId: string;
  workspaceId: string;
  generation: number;
  deadlineAt: number;
}
export interface WorkspaceProvisionCommand extends WorkspaceCommandBase {
  action: 'provision';
  recipeId: string;
  recipeRevision: string;
  runtimeDigest: string;
  catalogRevision: string;
  toolchain: ToolchainPackRef[];
  runnerPlugins: PluginRunnerTarget[];
  acpProfiles: WorkspaceAcpProfile[];
  browserTarget: WorkspaceBrowserTarget | null;
  retained: boolean;
}
export interface WorkspaceLifecycleCommand extends WorkspaceCommandBase {
  action: 'start' | 'stop' | 'restart' | 'delete';
}
export type WorkspaceRuntimeCommand = WorkspaceProvisionCommand | WorkspaceLifecycleCommand;
export interface RunnerWorkspaceProjection {
  workspaceId: string;
  generation: number;
  status: WorkspaceStatus;
}
export interface RunnerCommandWireResponse {
  commandId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown';
  result?: unknown;
  error?: unknown;
}
export interface WorkspaceJobInput {
  jobId: string;
  generation: number;
  deadlineAt: number;
  argv: string[];
  cwd: string;
  maxBytes: number;
  timeoutMs: number;
}
export interface WorkspaceJobRequest extends WorkspaceJobInput {
  workspaceId: string;
}
export interface WorkspaceJobResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
}
export interface WorkspaceJobView {
  jobId: string;
  workspaceId: string;
  generation: number;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'cancelled';
  result: WorkspaceJobResult | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface RunnerProjectInstruction {
  path: string;
  scopePath: string;
  projectRoot: string;
  hash: string;
  content: string;
  sourceBytes: number;
  contentBytes: number;
  truncated: boolean;
  provenance: 'workspace';
}
export interface RunnerProjectInstructionOmission {
  path: string;
  reason: 'source_too_large' | 'invalid_utf8' | 'total_budget' | 'too_many_files';
}
export interface RunnerProjectInstructionProjection {
  targetDirectories: string[];
  instructions: RunnerProjectInstruction[];
  omitted: RunnerProjectInstructionOmission[];
}

export interface WorkspaceFileReadRequest {
  path: string;
  startLine?: number;
  endLine?: number;
  offsetBytes?: number;
  maxBytes?: number;
}
export interface WorkspaceFileReadResult {
  path: string;
  sha256: string;
  sizeBytes: number;
  content: string;
  startLine: number | null;
  endLine: number | null;
  offsetBytes: number | null;
  contentBytes: number;
  truncated: boolean;
}
export interface WorkspaceFileStatResult {
  path: string;
  exists: boolean;
  type: 'file' | 'directory' | null;
  sizeBytes: number | null;
  modifiedAt: number | null;
  mode: number | null;
  sha256: string | null;
}
export interface WorkspaceFileWriteRequest {
  path: string;
  content: string;
  expectedSha256: string | null;
  mode?: number;
}
export interface WorkspaceFileWriteResult {
  path: string;
  sha256: string;
  sizeBytes: number;
  modifiedAt: number;
  created: boolean;
}
export interface WorkspaceFileListRequest {
  path: string;
  maxEntries: number;
}
export interface WorkspaceFileListEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  sizeBytes: number;
  modifiedAt: number;
}
export interface WorkspaceFileListResult {
  path: string;
  entries: WorkspaceFileListEntry[];
  truncated: boolean;
}
export interface WorkspaceFileMoveRequest {
  path: string;
  destinationPath: string;
  expectedSha256: string | null;
}
export interface WorkspaceFileMoveResult {
  path: string;
  destinationPath: string;
  type: 'file' | 'directory';
  sha256: string | null;
}
export interface WorkspaceFileDeleteRequest {
  path: string;
  recursive: boolean;
  expectedSha256: string | null;
}
export interface WorkspaceFileDeleteResult {
  path: string;
  type: 'file' | 'directory';
  deleted: true;
}
export interface WorkspaceSearchRequest {
  query: string;
  path: string;
  glob?: string;
  maxResults: number;
  contextLines: number;
  maxOutputBytes: number;
}
export interface WorkspaceSearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
  before: string[];
  after: string[];
}
export interface WorkspaceSearchResult {
  query: string;
  path: string;
  engine: 'rg' | 'fallback';
  matches: WorkspaceSearchMatch[];
  truncated: boolean;
  scannedFiles: number;
  scannedBytes: number;
}
export interface WorkspaceRepoMapRequest {
  path: string;
  query?: string;
  maxFiles: number;
  maxSymbols: number;
  maxOutputBytes: number;
}
export interface WorkspaceRepoMapSymbol {
  name: string;
  kind: string;
  line: number;
  column: number;
  signature: string;
}
export interface WorkspaceRepoMapFile {
  path: string;
  sha256: string;
  sizeBytes: number;
  imports: string[];
  symbols: WorkspaceRepoMapSymbol[];
}
export interface WorkspaceRepoMapResult {
  engine: 'typescript-native';
  path: string;
  query: string | null;
  revision: string;
  indexedFiles: number;
  indexedBytes: number;
  cacheHits: number;
  cacheMisses: number;
  files: WorkspaceRepoMapFile[];
  truncated: boolean;
  fallback: {
    searchTool: 'file_search';
    readTool: 'file_read';
    unsupportedLanguages: true;
  };
}
export type WorkspaceCodeIntelAction = 'symbols' | 'definition' | 'references' | 'diagnostics';
export interface WorkspaceCodeIntelRequest {
  action: WorkspaceCodeIntelAction;
  path: string;
  line?: number;
  column?: number;
  maxResults: number;
  maxOutputBytes: number;
}
export interface WorkspaceCodeIntelLocation {
  path: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  name?: string;
  kind?: string;
  signature?: string;
}
export interface WorkspaceCodeIntelDiagnostic {
  path: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  code: number;
  category: string;
  text: string;
}
export interface WorkspaceCodeIntelResult {
  action: WorkspaceCodeIntelAction;
  path: string;
  engine: 'typescript-native' | 'fallback';
  supported: boolean;
  revision: string | null;
  sha256: string | null;
  results: Array<WorkspaceRepoMapSymbol | WorkspaceCodeIntelLocation | WorkspaceCodeIntelDiagnostic>;
  truncated: boolean;
  fallback: null | {
    reason: 'LANGUAGE_UNSUPPORTED' | 'FILE_NOT_INDEXED';
    searchTool: 'file_search';
    readTool: 'file_read';
  };
}
export interface WorkspacePatchExpectedFile {
  path: string;
  sha256: string;
}
export interface WorkspaceApplyPatchRequest {
  patch: string;
  expectedFiles: WorkspacePatchExpectedFile[];
  dryRun?: boolean;
}
export interface WorkspacePatchChange {
  path: string;
  beforeSha256: string;
  afterSha256: string;
  beforeBytes: number;
  afterBytes: number;
  additions: number;
  deletions: number;
}
export interface WorkspaceApplyPatchResult {
  changes: WorkspacePatchChange[];
  applied: boolean;
}
