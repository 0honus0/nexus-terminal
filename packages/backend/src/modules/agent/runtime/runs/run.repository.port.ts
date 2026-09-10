import type { Scope } from '../../agent.types';
import type { ToolInspection } from '../../capabilities/tool.types';
import type { HostEvent, RunEvent, RunSnapshot, RunView } from './run.types';

export interface RunPage {
  items: RunView[];
  nextCursor: string | null;
}

export interface PendingMutationTool {
  toolCallId: string;
  stepId: string;
  runtimeId: string;
  providerCallId: string;
  approvalId: string;
  approvalVersion: number;
  inspection: ToolInspection;
}

export interface RunRepositoryPort {
  snapshot(scope: Scope, runId: string): Promise<RunSnapshot | null>;
  list(scope: Scope, threadId: string | undefined, limit: number, before?: string): Promise<RunPage>;
  readEvents(scope: Scope, runId: string, after: number, limit: number): Promise<RunEvent[]>;
  readHostEvents(userId: number, after: number, limit: number): Promise<HostEvent[]>;
  hostCursor(userId: number): Promise<number>;
  rootRuntimeId(scope: Scope, runId: string): Promise<string>;
  pendingMutation(scope: Scope, runId: string): Promise<PendingMutationTool | null>;
  createdQueue(limit: number): Promise<RunView[]>;
}

export type { Scope } from '../../agent.types';
