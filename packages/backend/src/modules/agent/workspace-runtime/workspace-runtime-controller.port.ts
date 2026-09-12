import type { JsonValue } from '../agent.types';
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
}
