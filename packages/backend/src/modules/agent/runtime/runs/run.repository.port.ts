import type { Scope } from '../../agent.types';
import type { ToolInspection } from '../../capabilities/tool.types';
import type {
  HostEvent,
  PendingRunInputPage,
  RunEvent,
  RunInputProjection,
  RunReconciliationView,
  RunSnapshot,
  RunView,
} from './run.types';

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

export interface ConfirmedMutationTool {
  toolCallId: string;
  providerCallId: string;
}

export interface RunSnapshotReaderPort {
  snapshot(scope: Scope, runId: string): Promise<RunSnapshot | null>;
}

export interface RunListReaderPort {
  list(scope: Scope, threadId: string | undefined, limit: number, before?: string): Promise<RunPage>;
}

export interface RunInputReaderPort {
  inputProjection(scope: Scope, runId: string): Promise<RunInputProjection>;
}

export interface RunQueryPort extends RunSnapshotReaderPort, RunListReaderPort, RunInputReaderPort {
  pendingInputs(scope: Scope, runId: string, limit: number): Promise<PendingRunInputPage>;
  reconciliation(scope: Scope, runId: string): Promise<RunReconciliationView>;
}

export interface RunEventReaderPort {
  readEvents(scope: Scope, runId: string, after: number, limit: number): Promise<RunEvent[]>;
  readHostEvents(userId: number, after: number, limit: number): Promise<HostEvent[]>;
}

export interface HostCursorReaderPort {
  hostCursor(userId: number): Promise<number>;
}

export interface RunExecutionReaderPort extends RunSnapshotReaderPort, RunInputReaderPort {
  rootRuntimeId(scope: Scope, runId: string): Promise<string>;
  pendingMutation(scope: Scope, runId: string): Promise<PendingMutationTool | null>;
  confirmedMutation(scope: Scope, runId: string, operationHash: string): Promise<ConfirmedMutationTool | null>;
}

export type { Scope } from '../../agent.types';
