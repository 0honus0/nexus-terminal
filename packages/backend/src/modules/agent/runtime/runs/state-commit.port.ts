import type { JsonValue, Scope } from '../../agent.types';

// Port contract rule: every side-effecting method must have a concrete runtime/lifecycle owner.
// Unused mutation contracts are deleted instead of preserved as a second durable state path.
import type { ModelFinishReason, ModelProviderContinuation, ModelRef } from '../../ai/model.types';
import type { LedgerEntryKind } from '../../ai/conversation.repository.port';
import type { ToolInspection, ToolResult } from '../../capabilities/tool.types';
import type { RunPlan } from '../planning/plan.types';
import type {
  RunBudget,
  RunDefinitionSnapshot,
  RunEvent,
  RunGoal,
  RunUsage,
  RunView,
  UserInputData,
  UserInputQuestion,
} from './run.types';

export interface AtomicCreateRun {
  scope: Scope;
  runId: string;
  runtimeId: string;
  threadId: string;
  inputEntryId: string;
  input: UserInputData;
  automaticThreadTitle?: string;
  parentRunId?: string | null;
  initialEntry?: { kind: LedgerEntryKind; payload: JsonValue; artifactRefs: string[] };
  initialPlan?: RunPlan;
  initialGoal?: RunGoal;
  agentDefinitionId: string;
  model: ModelRef;
  connectionIds: number[];
  budget: RunBudget;
  definition: RunDefinitionSnapshot;
  expectedPolicyRevision: number;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
  now: number;
}

export interface CreateRunCommitResult {
  run: RunView;
  inputSequence: number;
  replayed: boolean;
}

export interface DurableEventInput {
  type: string;
  payload: JsonValue;
}

export interface LedgerAppendInput {
  id: string;
  kind: LedgerEntryKind;
  payload: JsonValue;
  runId?: string;
}

export interface RunProjectionPatch {
  status?: RunView['status'];
  goalStatus?: RunView['goalStatus'];
  verificationStatus?: RunView['verificationStatus'];
  needsReconciliation?: boolean;
  budget?: RunBudget;
  usage?: RunUsage;
  plan?: RunPlan;
  consumedInputSequence?: number;
  inputRevision?: number;
  startedAt?: number | null;
  completedAt?: number | null;
}

export interface StateCommitCommand {
  scope: Scope;
  runId: string;
  expectedRunVersion: number;
  expectedInputRevision?: number;
  expectedPolicyRevision?: number;
  events: DurableEventInput[];
  runPatch: RunProjectionPatch;
  ledgerAppends?: LedgerAppendInput[];
  now: number;
}

export interface StateCommitResult {
  run: RunView;
  eventCursor: number;
  ledgerCursor: number;
  committedEvents: RunEvent[];
}

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

export interface AtomicAppendInput {
  scope: Scope;
  runId: string;
  inputEntryId: string;
  input: UserInputData;
  automaticThreadTitle?: string;
  mode: 'append' | 'interrupt';
  expectedRunVersion: number;
  idempotencyKey: string;
  requestHash: string;
  now: number;
}

export interface AppendInputCommitResult {
  inputId: string;
  sequence: number;
  runVersion: number;
  run: RunView;
  replayed: boolean;
  shouldInterruptModel: boolean;
  shouldReschedule: boolean;
}

export interface AtomicMutatePendingInput {
  scope: Scope;
  runId: string;
  action: 'remove' | 'move';
  inputId: string;
  beforeInputId: string | null;
  expectedRunVersion: number;
  idempotencyKey: string;
  requestHash: string;
  now: number;
}

export interface MutatePendingInputCommitResult {
  run: RunView;
  replayed: boolean;
  shouldInterruptModel: boolean;
}

export interface AtomicSetRunGoal {
  scope: Scope;
  runId: string;
  text: string;
  expectedRunVersion: number;
  idempotencyKey: string;
  requestHash: string;
  now: number;
}

export interface SetRunGoalCommitResult {
  run: RunView;
  replayed: boolean;
  shouldInterruptModel: boolean;
  shouldReschedule: boolean;
}

export interface AtomicCancelRun {
  scope: Scope;
  runId: string;
  expectedRunVersion: number;
  idempotencyKey: string;
  requestHash: string;
  now: number;
}

export interface CancelRunCommitResult {
  run: RunView;
  accepted: boolean;
  replayed: boolean;
}

export interface AtomicIncreaseRunBudget {
  scope: Scope;
  runId: string;
  expectedRunVersion: number;
  budget: RunBudget;
  idempotencyKey: string;
  requestHash: string;
  now: number;
}

export interface IncreaseRunBudgetCommitResult {
  run: RunView;
  replayed: boolean;
}

export interface AtomicDeleteRun {
  scope: Scope;
  runId: string;
  expectedRunVersion: number;
  idempotencyKey: string;
  requestHash: string;
  now: number;
}

export interface DeleteRunCommitResult {
  runId: string;
  deleted: true;
  replayed: boolean;
  hostEventCursor: number;
}

export interface ResolveRunReconciliationResource {
  resourceKey: string;
  version: number;
}

export interface ResolveRunReconciliationCommand {
  scope: Scope;
  runId: string;
  expectedRunVersion: number;
  note: string;
  resources: ResolveRunReconciliationResource[];
  now: number;
}

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

export interface StateCommitPort {
  createRun(command: AtomicCreateRun): Promise<CreateRunCommitResult>;
  appendInput(command: AtomicAppendInput): Promise<AppendInputCommitResult>;
  mutatePendingInput(command: AtomicMutatePendingInput): Promise<MutatePendingInputCommitResult>;
  setRunGoal(command: AtomicSetRunGoal): Promise<SetRunGoalCommitResult>;
  cancelRun(command: AtomicCancelRun): Promise<CancelRunCommitResult>;
  increaseRunBudget(command: AtomicIncreaseRunBudget): Promise<IncreaseRunBudgetCommitResult>;
  deleteRun(command: AtomicDeleteRun): Promise<DeleteRunCommitResult>;
  resolveRunReconciliation(command: ResolveRunReconciliationCommand): Promise<StateCommitResult>;
  supersedeRunApprovals(scope: Scope, runId: string, now: number): Promise<number>;
  beginModelStep(command: BeginModelStepCommand): Promise<BeginModelStepResult>;
  beginSubagentModelStep(command: BeginSubagentModelStepCommand): Promise<BeginModelStepResult>;
  pauseRuntimeForBudget(command: PauseRuntimeForBudgetCommand): Promise<StateCommitResult>;
  parkRuntime(command: ParkRuntimeCommand): Promise<StateCommitResult>;
  parkModelStep(command: ParkModelStepCommand): Promise<StateCommitResult>;
  continueModelStepForCompletionGate(command: ContinueModelStepForCompletionGateCommand): Promise<StateCommitResult>;
  commitSubagentToolProposalBatch(
    command: CommitSubagentToolProposalBatchCommand,
  ): Promise<CommitToolProposalBatchResult>;
  beginSubagentTool(command: BeginSubagentToolCommand): Promise<StateCommitResult>;
  settleSubagentTool(command: SettleSubagentToolCommand): Promise<StateCommitResult>;
  settleSubagentWithoutModel(command: SettleSubagentWithoutModelCommand): Promise<StateCommitResult>;
  settleSubagentModelStep(command: SettleSubagentModelStepCommand): Promise<StateCommitResult>;
  retryModelStep(command: RetryModelStepCommand): Promise<RetryModelStepResult>;
  changeModelRoute(command: ChangeModelRouteCommand): Promise<ChangeModelRouteResult>;
  pauseModelStepForBudget(command: PauseModelStepForBudgetCommand): Promise<StateCommitResult>;
  settleModelStep(command: SettleModelStepCommand): Promise<StateCommitResult>;
  commitToolProposalBatch(command: CommitToolProposalBatchCommand): Promise<CommitToolProposalBatchResult>;
  refreshProposedTool(command: RefreshProposedToolCommand): Promise<StateCommitResult>;
  rejectProposedTool(command: RejectProposedToolCommand): Promise<StateCommitResult>;
  requestToolApproval(command: RequestToolApprovalCommand): Promise<StateCommitResult>;
  resolveToolApproval(command: ResolveToolApprovalCommand): Promise<StateCommitResult>;
  supersedeMutationTool(command: SupersedeMutationToolCommand): Promise<StateCommitResult>;
  expireToolApprovals(now: number): Promise<RunView[]>;
  cleanupExpiredCommands(now: number, limit?: number): Promise<number>;
  beginReadToolBatch(command: BeginReadToolBatchCommand): Promise<StateCommitResult>;
  beginMutationTool(command: BeginMutationToolCommand): Promise<StateCommitResult>;
  settleReadToolBatch(command: SettleReadToolBatchCommand): Promise<StateCommitResult>;
  settleUserInputRequestTool(command: SettleUserInputRequestToolCommand): Promise<StateCommitResult>;
  settleMutationTool(command: SettleMutationToolCommand): Promise<StateCommitResult>;
  evaluateToolLoopGuard(command: EvaluateToolLoopGuardCommand): Promise<StateCommitResult>;
  supersedeModelStep(command: SupersedeModelStepCommand): Promise<StateCommitResult>;
  commit(command: StateCommitCommand): Promise<StateCommitResult>;
  interruptUnexpectedRootExecution(command: InterruptUnexpectedRootExecutionCommand): Promise<StateCommitResult | null>;
  quiesceApp(scope: Scope, now: number): Promise<number>;
  interruptNonTerminalRuns(now: number): Promise<RunView[]>;
}

export type RunCommandCommitPort = Pick<
  StateCommitPort,
  | 'createRun'
  | 'appendInput'
  | 'mutatePendingInput'
  | 'setRunGoal'
  | 'cancelRun'
  | 'increaseRunBudget'
  | 'deleteRun'
  | 'resolveRunReconciliation'
>;

export type RunCreationCommitPort = Pick<StateCommitPort, 'createRun'>;
export type CheckpointRecoveryCommitPort = Pick<StateCommitPort, 'createRun' | 'supersedeRunApprovals' | 'commit'>;
export type ApprovalDecisionCommitPort = Pick<StateCommitPort, 'resolveToolApproval'>;
export type ApprovalSweepCommitPort = Pick<StateCommitPort, 'expireToolApprovals' | 'cleanupExpiredCommands'>;
export type ProjectionCommitPort = Pick<StateCommitPort, 'commit'>;

export type CollaborationCommitPort = Pick<
  StateCommitPort,
  | 'beginSubagentModelStep'
  | 'beginSubagentTool'
  | 'commitSubagentToolProposalBatch'
  | 'settleSubagentModelStep'
  | 'settleSubagentTool'
  | 'settleSubagentWithoutModel'
  | 'evaluateToolLoopGuard'
>;

export type RootExecutionCommitPort = Pick<
  StateCommitPort,
  | 'beginModelStep'
  | 'beginMutationTool'
  | 'beginReadToolBatch'
  | 'commit'
  | 'commitToolProposalBatch'
  | 'continueModelStepForCompletionGate'
  | 'interruptUnexpectedRootExecution'
  | 'parkModelStep'
  | 'parkRuntime'
  | 'pauseModelStepForBudget'
  | 'pauseRuntimeForBudget'
  | 'requestToolApproval'
  | 'refreshProposedTool'
  | 'rejectProposedTool'
  | 'resolveToolApproval'
  | 'retryModelStep'
  | 'changeModelRoute'
  | 'settleModelStep'
  | 'settleMutationTool'
  | 'settleReadToolBatch'
  | 'settleUserInputRequestTool'
  | 'evaluateToolLoopGuard'
  | 'supersedeModelStep'
  | 'supersedeMutationTool'
>;
