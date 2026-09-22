import type { JsonValue, Scope } from '../../agent.types';
import type { ModelFinishReason, ModelProviderContinuation } from '../../ai/model.types';
import type { ToolInspection, ToolResult } from '../../capabilities/tool.types';
import type { RunUsage, UserInputQuestion } from './run.types';
import type { StateCommitResult } from './state-commit-common.contracts';

export interface CommitToolProposalBatchItem {
  providerCallId: string;
  toolCallId: string;
  toolName: string;
  toolVersion: string;
  argumentsJson: string;
  modelToolName?: string;
  modelArgumentsJson?: string;
  inspection: ToolInspection;
}

export interface CommitToolProposalBatchCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  modelStepId: string;
  attemptId: string;
  expectedRunVersion: number;
  assistantEntryId: string;
  assistantText: string;
  items: CommitToolProposalBatchItem[];
  usage: RunUsage;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  estimatedUsage?: boolean;
  finishReason?: ModelFinishReason | null;
  providerContinuation?: ModelProviderContinuation;
  now: number;
}

export interface CommitToolProposalBatchResultItem {
  providerCallId: string;
  toolCallId: string;
  toolStepId: string;
}

export interface CommitToolProposalBatchResult extends StateCommitResult {
  items: CommitToolProposalBatchResultItem[];
}

export interface CommitToolProposalResult extends StateCommitResult {
  toolStepId: string;
  toolCallId: string;
}

export interface RefreshProposedToolCommand {
  scope: Scope;
  runId: string;
  toolStepId: string;
  toolCallId: string;
  expectedRunVersion: number;
  inspection: ToolInspection;
  now: number;
}

export interface RejectProposedToolCommand {
  scope: Scope;
  runId: string;
  toolStepId: string;
  toolCallId: string;
  expectedRunVersion: number;
  providerCallId: string;
  result: ToolResult;
  now: number;
}

export interface RequestToolApprovalCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  toolStepId: string;
  toolCallId: string;
  approvalId: string;
  expectedRunVersion: number;
  inspection: ToolInspection;
  expiresAt: number;
  now: number;
}

export interface RequestAcpPermissionApprovalCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  parentToolCallId: string;
  parentOperationHash: string;
  approvalId: string;
  inspection: ToolInspection;
  expiresAt: number;
  now: number;
}

export interface CloseAcpPermissionApprovalCommand {
  scope: Scope;
  runId: string;
  approvalId: string;
  expectedApprovalVersion: number;
  status: 'expired' | 'superseded';
  now: number;
}

export interface ResolveToolApprovalCommand {
  scope: Scope;
  runId: string;
  approvalId: string;
  decision: 'approved' | 'denied';
  operationHash: string;
  expectedApprovalVersion: number;
  expectedRunVersion: number;
  expectedPolicyRevision: number;
  expectedInputRevision: number;
  decidedByUserId: number;
  feedback?: string;
  resolutionSource?: 'user' | 'full_access';
  idempotencyKey: string;
  requestHash: string;
  now: number;
}

export interface BeginMutationToolCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  toolStepId: string;
  toolCallId: string;
  approvalId: string;
  expectedRunVersion: number;
  operationHash: string;
  expectedPolicyRevision: number;
  expectedInputRevision: number;
  now: number;
}

export interface SupersedeMutationToolCommand {
  scope: Scope;
  runId: string;
  toolStepId: string;
  toolCallId: string;
  approvalId: string;
  expectedRunVersion: number;
  reason: string;
  errorCode: string;
  details?: JsonValue;
  now: number;
}

export interface ToolBatchIdentity {
  toolStepId: string;
  toolCallId: string;
}

export interface BeginReadToolBatchCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  expectedRunVersion: number;
  items: ToolBatchIdentity[];
  now: number;
}

export interface SettleReadToolBatchItem extends ToolBatchIdentity {
  toolResultEntryId: string;
  providerCallId: string;
  result: ToolResult;
}

export interface SettleReadToolBatchCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  expectedRunVersion: number;
  items: SettleReadToolBatchItem[];
  now: number;
}

export interface SettleUserInputRequestToolCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  toolStepId: string;
  toolCallId: string;
  expectedRunVersion: number;
  toolResultEntryId: string;
  providerCallId: string;
  requestId: string;
  questions: UserInputQuestion[];
  result: ToolResult;
  now: number;
}

export interface ParkMcpInputRequiredToolCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  toolStepId: string;
  toolCallId: string;
  expectedRunVersion: number;
  providerCallId: string;
  requestId: string;
  questions: UserInputQuestion[];
  continuation: JsonValue;
  now: number;
}

export interface SettleMutationToolCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  toolStepId: string;
  toolCallId: string;
  expectedRunVersion: number;
  toolResultEntryId: string;
  providerCallId: string;
  result: ToolResult;
  usage: RunUsage;
  now: number;
  needsReconciliation?: boolean;
}

export interface EvaluateToolLoopGuardCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  delegationId?: string;
  expectedRunVersion: number;
  observations: Array<{
    toolName: string;
    risk: ToolInspection['risk'];
    operationHash: string;
    result: ToolResult;
  }>;
  now: number;
}
