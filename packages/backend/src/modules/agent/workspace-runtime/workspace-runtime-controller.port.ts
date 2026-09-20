import type { JsonValue } from '../agent.types';
import type { ProjectInstructionProjection } from '../ai/project-instruction-source.port';
import type {
  WorkspaceRuntimeAvailability,
  WorkspaceRuntimeCatalog,
  WorkspaceRuntimeStorageView,
} from './workspace-runtime.types';

export interface RunnerCommandRequest {
  commandId: string;
  action: string;
  generation: number;
  deadlineAt: number;
  payload: JsonValue;
}

export interface RunnerCommandResult {
  commandId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown';
  result: JsonValue | null;
}

export interface AgentWorkspaceReadHandle {
  sizeBytes: number;
  source: AsyncIterable<Uint8Array>;
  close(): Promise<void>;
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
    searchTool: 'workspace_search';
    readTool: 'workspace_read_file';
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
    searchTool: 'workspace_search';
    readTool: 'workspace_read_file';
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

export interface WorkspaceRuntimeControllerPort {
  availability(signal?: AbortSignal): Promise<WorkspaceRuntimeAvailability>;
  catalog(signal?: AbortSignal): Promise<WorkspaceRuntimeCatalog>;
  storage(signal?: AbortSignal): Promise<WorkspaceRuntimeStorageView>;
  submit(command: RunnerCommandRequest, signal?: AbortSignal): Promise<RunnerCommandResult>;
  query(commandId: string, signal?: AbortSignal): Promise<RunnerCommandResult>;
  projectInstructions(
    workspaceId: string,
    generation: number,
    targetDirectories: readonly string[],
    signal?: AbortSignal,
  ): Promise<Omit<ProjectInstructionProjection, 'workspaceId' | 'generation'>>;
  readWorkspaceFile(
    workspaceId: string,
    generation: number,
    request: WorkspaceFileReadRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileReadResult>;
  searchWorkspace(
    workspaceId: string,
    generation: number,
    request: WorkspaceSearchRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceSearchResult>;
  repoMap(
    workspaceId: string,
    generation: number,
    request: WorkspaceRepoMapRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceRepoMapResult>;
  codeIntel(
    workspaceId: string,
    generation: number,
    request: WorkspaceCodeIntelRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceCodeIntelResult>;
  applyWorkspacePatch(
    workspaceId: string,
    generation: number,
    request: WorkspaceApplyPatchRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceApplyPatchResult>;
  openWorkspaceFileRead(
    workspaceId: string,
    generation: number,
    targetPluginId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<AgentWorkspaceReadHandle>;
  writeWorkspaceFileStream(
    workspaceId: string,
    generation: number,
    targetPluginId: string,
    path: string,
    source: AsyncIterable<Uint8Array>,
    expectedBytes: number,
    signal?: AbortSignal,
  ): Promise<void>;
  openWorkspaceCheckpointArchive(
    workspaceId: string,
    generation: number,
    signal?: AbortSignal,
  ): Promise<AgentWorkspaceReadHandle>;
  restoreWorkspaceCheckpointArchive(
    workspaceId: string,
    generation: number,
    source: AsyncIterable<Uint8Array>,
    expectedBytes: number,
    signal?: AbortSignal,
  ): Promise<void>;
}
