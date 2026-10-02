import type {
  RunnerWorkspaceProjection,
  WorkspaceApplyPatchRequest,
  WorkspaceApplyPatchResult,
  WorkspaceCodeIntelRequest,
  WorkspaceCodeIntelResult,
  WorkspaceFileDeleteRequest,
  WorkspaceFileDeleteResult,
  WorkspaceFileListRequest,
  WorkspaceFileListResult,
  WorkspaceFileMoveRequest,
  WorkspaceFileMoveResult,
  WorkspaceFileReadRequest,
  WorkspaceFileReadResult,
  WorkspaceFileStatResult,
  WorkspaceFileWriteRequest,
  WorkspaceFileWriteResult,
  WorkspaceRepoMapRequest,
  WorkspaceRepoMapResult,
  WorkspaceSearchRequest,
  WorkspaceSearchResult,
} from '@nexus-terminal/protocol/runner';
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

export interface WorkspaceRuntimeControllerPort {
  availability(signal?: AbortSignal): Promise<WorkspaceRuntimeAvailability>;
  catalog(signal?: AbortSignal): Promise<WorkspaceRuntimeCatalog>;
  storage(signal?: AbortSignal): Promise<WorkspaceRuntimeStorageView>;
  submit(command: RunnerCommandRequest, signal?: AbortSignal): Promise<RunnerCommandResult>;
  query(commandId: string, signal?: AbortSignal): Promise<RunnerCommandResult>;
  workspaceStatus(workspaceId: string, generation: number, signal?: AbortSignal): Promise<RunnerWorkspaceProjection>;
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
  statWorkspacePath(
    workspaceId: string,
    generation: number,
    path: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileStatResult>;
  writeWorkspaceFile(
    workspaceId: string,
    generation: number,
    request: WorkspaceFileWriteRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileWriteResult>;
  listWorkspaceFiles(
    workspaceId: string,
    generation: number,
    request: WorkspaceFileListRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileListResult>;
  moveWorkspaceFile(
    workspaceId: string,
    generation: number,
    request: WorkspaceFileMoveRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileMoveResult>;
  deleteWorkspaceFile(
    workspaceId: string,
    generation: number,
    request: WorkspaceFileDeleteRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceFileDeleteResult>;
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
