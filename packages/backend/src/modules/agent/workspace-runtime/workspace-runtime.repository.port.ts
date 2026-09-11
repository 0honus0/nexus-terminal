import type { JsonValue, Scope } from '../agent.types';
import type {
  AgentWorkspaceCreateSpec,
  AgentWorkspaceView,
  ToolchainPackRef,
  WorkspaceProfileView,
  WorkspaceRuntimeCommandView,
  WorkspaceStatus,
} from './workspace-runtime.types';

export interface CreateWorkspaceRecord {
  scope: Scope;
  id: string;
  commandId: string;
  idempotencyKey: string;
  requestHash: string;
  runId: string;
  agentRuntimeId: string;
  retained: boolean;
  profile: WorkspaceProfileView;
  generation: number;
  createdAt: number;
}

export interface CreateWorkspaceRuntimeCommandRecord {
  scope: Scope;
  id: string;
  workspaceId?: string;
  action: string;
  operationHash: string;
  generation: number;
  request: JsonValue;
  deadlineAt: number;
  createdAt: number;
}

export interface ReconfigureWorkspaceRecord {
  scope: Scope;
  workspaceId: string;
  expectedVersion: number;
  expectedGeneration: number;
  recipeRevision: string;
  runtimeDigest: string;
  catalogRevision: string;
  toolchain: ToolchainPackRef[];
  generation: number;
  now: number;
}

export interface AgentWorkspaceRepositoryPort {
  createWorkspace(record: CreateWorkspaceRecord): Promise<AgentWorkspaceView>;
  listWorkspaces(scope: Scope, runId?: string): Promise<AgentWorkspaceView[]>;
  listUserWorkspaces(userId: number): Promise<AgentWorkspaceView[]>;
  getWorkspace(scope: Scope, workspaceId: string): Promise<AgentWorkspaceView | null>;
  setWorkspaceStatus(
    scope: Scope,
    workspaceId: string,
    expectedVersion: number,
    status: WorkspaceStatus,
    now: number,
  ): Promise<AgentWorkspaceView>;
  reconfigureWorkspace(record: ReconfigureWorkspaceRecord): Promise<AgentWorkspaceView>;
  createCommand(record: CreateWorkspaceRuntimeCommandRecord): Promise<WorkspaceRuntimeCommandView>;
  getCommand(scope: Scope, commandId: string): Promise<WorkspaceRuntimeCommandView | null>;
  completeCommand(
    scope: Scope,
    commandId: string,
    status: WorkspaceRuntimeCommandView['status'],
    result: JsonValue | null,
    now: number,
  ): Promise<WorkspaceRuntimeCommandView>;
  listPendingCommands(limit: number): Promise<WorkspaceRuntimeCommandView[]>;
}

export type { AgentWorkspaceCreateSpec };
