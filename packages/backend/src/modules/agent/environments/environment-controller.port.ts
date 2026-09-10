import type { JsonValue } from '../agent.types';
import type {
  EnvironmentAvailability,
  EnvironmentCatalog,
  EnvironmentStorageView,
  EnvironmentWorkspaceGrant,
  EnvironmentWorkspaceGrantInput,
} from './environment.types';

export interface RunnerCommandRequest {
  commandId: string;
  operationHash: string;
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

export interface EnvironmentWorkspaceReadHandle {
  sizeBytes: number;
  source: AsyncIterable<Uint8Array>;
  close(): Promise<void>;
}

export interface EnvironmentControllerPort {
  availability(signal?: AbortSignal): Promise<EnvironmentAvailability>;
  catalog(signal?: AbortSignal): Promise<EnvironmentCatalog>;
  storage(signal?: AbortSignal): Promise<EnvironmentStorageView>;
  submit(command: RunnerCommandRequest, signal?: AbortSignal): Promise<RunnerCommandResult>;
  query(commandId: string, signal?: AbortSignal): Promise<RunnerCommandResult>;
  workspaceGrants(
    environmentId: string,
    generation: number,
    targetPluginId: string,
    signal?: AbortSignal,
  ): Promise<EnvironmentWorkspaceGrant[]>;
  replaceWorkspaceGrants(
    environmentId: string,
    generation: number,
    targetPluginId: string,
    grants: readonly EnvironmentWorkspaceGrantInput[],
    signal?: AbortSignal,
  ): Promise<EnvironmentWorkspaceGrant[]>;
  openWorkspaceFileRead(
    environmentId: string,
    generation: number,
    targetPluginId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<EnvironmentWorkspaceReadHandle>;
  writeWorkspaceFileStream(
    environmentId: string,
    generation: number,
    targetPluginId: string,
    path: string,
    source: AsyncIterable<Uint8Array>,
    expectedBytes: number,
    signal?: AbortSignal,
  ): Promise<void>;
}
