import type { JsonValue, Scope } from '../../agent.types';
import type { ModelFinishReason, ModelProviderContinuation, ModelRef } from '../../ai/model.types';
import type { ToolInspection, ToolResult } from '../../capabilities/tool.types';
import type { RunEvent, RunUsage, RunView } from './run.types';
import type { StateCommitResult } from './state-commit-common.contracts';

export interface BeginModelStepCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  expectedRunVersion: number;
  inputWatermark: number;
  reservedTokens: number;
  estimatedInputTokens: number;
  heuristicInputTokens?: number;
  contextSource?: 'estimated' | 'anchored_estimate';
  reservedOutputTokens: number;
  contextWindowTokens: number;
  contextEpoch?: string;
  model?: ModelRef;
  now: number;
}

export interface BeginModelStepResult {
  run: RunView;
  stepId: string;
  attemptId: string;
  attemptIndex: number;
  committedEvents: RunEvent[];
}

export interface BeginSubagentModelStepCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  delegationId: string;
  workId: string;
  ownerEpoch: number;
  reservedTokens: number;
  now: number;
}

export interface PauseRuntimeForBudgetCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  expectedRunVersion: number;
  budgetReason: JsonValue;
  now: number;
}

export interface ParkRuntimeCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  expectedRunVersion: number;
  reason: 'waiting_subagents' | 'waiting_message';
  now: number;
}

export interface ParkModelStepCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  stepId: string;
  attemptId: string;
  expectedRunVersion: number;
  assistantEntryId?: string;
  assistantText?: string;
  usage: RunUsage;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  estimatedUsage: boolean;
  finishReason: ModelFinishReason | null;
  providerContinuation?: ModelProviderContinuation;
  reason: 'waiting_subagents' | 'waiting_message';
  now: number;
}

export interface ContinueModelStepForCompletionGateCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  stepId: string;
  attemptId: string;
  expectedRunVersion: number;
  assistantEntryId: string;
  assistantText: string;
  noticeEntryId: string;
  notice: string;
  reasonCode: 'COMPLETION_PLAN_INCOMPLETE' | 'COMPLETION_EVIDENCE_REQUIRED';
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  estimatedUsage: boolean;
  finishReason: ModelFinishReason;
  providerContinuation?: ModelProviderContinuation;
  now: number;
}

export interface CommitSubagentToolProposalBatchItem {
  providerCallId: string;
  toolCallId: string;
  toolName: string;
  toolVersion: string;
  inspection: ToolInspection;
  rejectedResult?: ToolResult;
}

export interface CommitSubagentToolProposalBatchCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  delegationId: string;
  workId: string;
  ownerEpoch: number;
  modelStepId: string;
  attemptId: string;
  expectedRunVersion: number;
  items: CommitSubagentToolProposalBatchItem[];
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  estimatedUsage: boolean;
  finishReason: ModelFinishReason | null;
  providerContinuation?: ModelProviderContinuation;
  now: number;
}

export interface BeginSubagentToolCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  delegationId: string;
  workId: string;
  ownerEpoch: number;
  toolStepId: string;
  toolCallId: string;
  now: number;
}

export interface BeginSubagentMutationToolCommand extends BeginSubagentToolCommand {
  approvalId: string;
  operationHash: string;
  expectedPolicyRevision: number;
  expectedInputRevision: number;
}

export interface SettleSubagentToolCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  delegationId: string;
  workId: string;
  ownerEpoch: number;
  toolStepId: string;
  toolCallId: string;
  result: ToolResult;
  needsReconciliation?: boolean;
  continuation: 'runnable' | 'joining' | 'waiting_message' | 'waiting_budget';
  budgetReason?: JsonValue;
  now: number;
}

export interface SettleSubagentWithoutModelCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  delegationId: string;
  workId: string;
  ownerEpoch: number;
  outcome: 'failed' | 'cancelled';
  result: JsonValue | null;
  errorCode: string;
  now: number;
}

export interface SettleSubagentModelStepCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  delegationId: string;
  workId: string;
  ownerEpoch: number;
  stepId: string;
  attemptId: string;
  outcome: 'completed' | 'failed' | 'cancelled';
  result: JsonValue | null;
  evidenceRefs: string[];
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  estimatedUsage: boolean;
  finishReason: ModelFinishReason | null;
  providerContinuation?: ModelProviderContinuation;
  errorCode?: string;
  now: number;
}

export interface RetryModelStepCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  stepId: string;
  attemptId: string;
  expectedRunVersion: number;
  reservedTokens: number;
  usage: RunUsage;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  estimatedUsage?: boolean;
  errorCode: string;
  now: number;
}

export interface RetryModelStepResult extends StateCommitResult {
  attemptId: string;
  attemptIndex: number;
}

export interface ChangeModelRouteCommand extends RetryModelStepCommand {
  fromModel: ModelRef;
  toModel: ModelRef;
  toRouteIndex: number;
  estimatedInputTokens: number;
  heuristicInputTokens?: number;
  contextSource?: 'estimated' | 'anchored_estimate';
  reservedOutputTokens: number;
  contextWindowTokens: number;
  contextEpoch?: string;
}

export interface ChangeModelRouteResult extends RetryModelStepResult {
  previousAttemptId: string;
}

export interface PauseModelStepForBudgetCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  stepId: string;
  attemptId: string;
  expectedRunVersion: number;
  usage: RunUsage;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  estimatedUsage?: boolean;
  errorCode: string;
  budgetReason: JsonValue;
  now: number;
}

export interface SettleModelStepCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  stepId: string;
  attemptId: string;
  expectedRunVersion: number;
  assistantEntryId?: string;
  assistantText?: string;
  usage: RunUsage;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  estimatedUsage?: boolean;
  finishReason?: ModelFinishReason | null;
  providerContinuation?: ModelProviderContinuation;
  errorCode?: string;
  verificationSummary?: string;
  terminalStatus: 'completed' | 'completed_unverified' | 'failed' | 'cancelled';
  now: number;
}

export interface SupersedeModelStepCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  stepId: string;
  attemptId: string;
  expectedInputRevision: number;
  expectedGoalRevision: number;
  reason: 'new_input' | 'goal_updated';
  usage: RunUsage;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  estimatedUsage?: boolean;
  now: number;
}

export interface InterruptUnexpectedRootExecutionCommand {
  scope: Scope;
  runId: string;
  errorCode: string;
  now: number;
}
