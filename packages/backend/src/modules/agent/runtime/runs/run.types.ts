import type { AgentDurableEventTypeDto, AgentHostEventTypeDto } from '@nexus-terminal/protocol/agent-events';
import type { AgentContextProfile } from '../../agent-defaults';
import type { AgentRunEnvironmentSelection, AgentRunEnvironmentSnapshot, JsonValue, Scope } from '../../agent.types';
import type { AgentModelCapability, ModelCapabilitySnapshot, ModelRef, ReasoningEffort } from '../../ai/model.types';
import type { RunPlan } from '../planning/plan.types';

export type RunStatus =
  | 'created'
  | 'running'
  | 'awaiting_approval'
  | 'awaiting_budget'
  | 'awaiting_input'
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

export interface UserInputChoice {
  value: string;
  label: string;
  description?: string;
}

export interface UserInputQuestion {
  id: string;
  prompt: string;
  kind: 'text' | 'choice';
  choices?: UserInputChoice[];
  recommendedChoice?: string;
  context?: string;
}

export interface PendingUserInputRequest {
  id: string;
  runtimeId: string;
  questions: UserInputQuestion[];
  requestedAt: number;
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

export type RunApprovalMode = 'ask' | 'full_access';
export type RunExecutionMode = 'execute' | 'plan';

export interface CreateRunCommand {
  threadId: string;
  input: UserInputData;
  agentDefinitionId: string;
  model: ModelRef;
  reasoningEffort?: ReasoningEffort;
  approvalMode: RunApprovalMode;
  executionMode: RunExecutionMode;
  plannedFromRunId?: string;
  connectionIds: number[];
  environment?: AgentRunEnvironmentSelection | null;
  initialGoal?: string;
  command: CommandIdentity;
}

export interface RunContextPolicy {
  profile: AgentContextProfile;
  effectiveWindowPercent: number;
  softPressurePercent: number;
  toolOutputFloorPercent: number;
}

export interface RunBudget {
  contextPolicy: RunContextPolicy;
  maxRunSteps: number;
  maxActiveExecutionSeconds: number;
  toolTimeoutSeconds: number;
  maxToolOutputBytes: number;
  maxRecallItems: number;
  maxRecallBytes: number;
  maxSubagentMessages: number;
  maxSubagentMessageBytes: number;
  contextCompactionMode: 'aggressive' | 'balanced' | 'conservative';
  revision: number;
}

export interface RunBudgetIncrease {
  maxRunSteps?: number;
  maxActiveExecutionSeconds?: number;
  maxSubagentMessages?: number;
  maxSubagentMessageBytes?: number;
}

export interface RunContextUsage {
  inputTokens: number;
  heuristicInputTokens?: number;
  reservedOutputTokens: number;
  contextWindowTokens: number;
  source: 'estimated' | 'anchored_estimate' | 'provider';
  model?: ModelRef;
  contextEpoch?: string;
  updatedAt: number;
}

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  steps: number;
  subagentMessages: number;
  subagentMessageBytes: number;
  context?: RunContextUsage;
}

export interface RunContextBoundary {
  baseThrough: number;
  runThrough: Record<string, number>;
}

export interface RunModelRouteSnapshot {
  model: ModelRef;
  modelCapabilities: ModelCapabilitySnapshot;
}

export interface RunDefinitionSnapshot {
  schemaVersion: 1;
  agentDefinitionId: string;
  requiredModelCapabilities: AgentModelCapability[];
  model: ModelRef;
  modelCapabilities: ModelCapabilitySnapshot;
  rootModelRoutes: RunModelRouteSnapshot[];
  reasoningEffort?: ReasoningEffort;
  approvalMode: RunApprovalMode;
  executionMode: RunExecutionMode;
  connectionIds: number[];
  environment: AgentRunEnvironmentSnapshot | null;
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

export interface RunReconciliationResource {
  resourceKey: string;
  toolCallId: string | null;
  reason: string;
  version: number;
  createdAt: number;
}

export interface RunReconciliationView {
  runId: string;
  required: boolean;
  resources: RunReconciliationResource[];
}

export interface RunEvent {
  eventId: string;
  runId: string;
  sequence: number;
  schemaVersion: 1;
  type: AgentDurableEventTypeDto;
  payload: JsonValue;
  occurredAt: number;
}

export interface HostEvent {
  userId: number;
  sequence: number;
  type: AgentHostEventTypeDto;
  payload: JsonValue;
  occurredAt: number;
}

export interface HostCursorWindow {
  oldestAvailableCursor: number;
  highWater: number;
}

export interface RunTerminalIssue {
  eventType: string;
  errorCode: string | null;
  reason: string | null;
  occurredAt: number;
}

export interface RunSnapshot extends RunView {
  terminalIssue: RunTerminalIssue | null;
  pendingInputRequest: PendingUserInputRequest | null;
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
