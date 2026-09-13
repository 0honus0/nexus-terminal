import type { AgentRunEnvironmentSelection, AgentRunEnvironmentSnapshot, JsonValue, Scope } from '../../agent.types';
import type { ModelRef } from '../../ai/model.types';
import type { RunPlan } from '../planning/plan.types';

export type RunStatus =
  | 'created'
  | 'running'
  | 'awaiting_approval'
  | 'awaiting_budget'
  | 'cancelling'
  | 'completed'
  | 'completed_unverified'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type GoalStatus = 'unknown' | 'in_progress' | 'satisfied' | 'not_satisfied';
export type VerificationStatus = 'not_started' | 'verified' | 'unverified' | 'failed';

export interface RunGoal {
  text: string | null;
  revision: number;
  updatedAt: number | null;
}

export interface PendingRunInput {
  id: string;
  sequence: number;
  text: string;
  artifactRefs: string[];
  createdAt: number;
}

export interface PendingRunInputPage {
  items: PendingRunInput[];
  total: number;
  hasMore: boolean;
}

export interface RunInputProjection {
  ordered: PendingRunInput[];
  pending: PendingRunInput[];
}

export interface UserInputData {
  text: string;
  artifactRefs: string[];
}

export interface CommandIdentity {
  key: string;
  requestId: string;
}

export interface CreateRunCommand {
  threadId: string;
  input: UserInputData;
  agentDefinitionId: string;
  model: ModelRef;
  connectionIds: number[];
  environment?: AgentRunEnvironmentSelection | null;
  initialGoal?: string;
  command: CommandIdentity;
}

export interface RunBudget {
  maxContextTokens: number;
  maxOutputTokens: number;
  maxRunTokens: number;
  maxRunSteps: number;
  maxRunCostMicros: number | null;
  maxActiveExecutionSeconds: number;
  toolTimeoutSeconds: number;
  maxToolOutputBytes: number;
  maxRawToolBytes: number;
  maxRecallItems: number;
  maxRecallBytes: number;
  maxSubagentMessages: number;
  maxSubagentMessageBytes: number;
  revision: number;
}

export interface RunBudgetIncrease {
  maxRunTokens?: number;
  maxRunSteps?: number;
  maxActiveExecutionSeconds?: number;
  maxSubagentMessages?: number;
  maxSubagentMessageBytes?: number;
  maxCostMicros?: number | null;
}

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costMicros: number;
  steps: number;
  subagentMessages: number;
  subagentMessageBytes: number;
}

export interface RunContextBoundary {
  baseThrough: number;
  runThrough: Record<string, number>;
}

export interface RunDefinitionSnapshot {
  schemaVersion: 1;
  agentDefinitionId: string;
  model: ModelRef;
  connectionIds: number[];
  environment?: AgentRunEnvironmentSnapshot | null;
  policyRevision: number;
  settingsRevision: number;
  contextBoundary?: RunContextBoundary;
}

export interface RunView extends Scope {
  id: string;
  threadId: string;
  parentRunId: string | null;
  status: RunStatus;
  goalStatus: GoalStatus;
  goal: RunGoal;
  verificationStatus: VerificationStatus;
  needsReconciliation: boolean;
  budget: RunBudget;
  definition: RunDefinitionSnapshot;
  plan: RunPlan;
  usage: RunUsage;
  activeExecutionSeconds: number;
  activeExecutionStartedAt: number | null;
  executingRuntimeCount: number;
  consumedInputSequence: number;
  inputRevision: number;
  eventCursor: number;
  version: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export interface RunEvent {
  eventId: string;
  runId: string;
  sequence: number;
  schemaVersion: 1;
  type: string;
  payload: JsonValue;
  occurredAt: number;
}

export interface HostEvent {
  userId: number;
  sequence: number;
  type: string;
  payload: JsonValue;
  occurredAt: number;
}

export interface RunSnapshot extends RunView {
  recentEntries: Array<{
    id: string;
    sequence: number;
    kind: string;
    payload: JsonValue;
    createdAt: number;
  }>;
}

export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  'completed',
  'completed_unverified',
  'failed',
  'cancelled',
  'interrupted',
]);
