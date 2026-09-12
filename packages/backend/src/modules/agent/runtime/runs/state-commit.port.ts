import type { JsonValue, Scope } from '../../agent.types';
import type { ModelRef } from '../../ai/model.types';
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
} from './run.types';

export interface AtomicCreateRun {
  scope: Scope;
  runId: string;
  runtimeId: string;
  threadId: string;
  inputEntryId: string;
  input: UserInputData;
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
  costMicros: number;
  priceVersion: string | null;
  finishReason: string | null;
  reason: 'waiting_subagents' | 'waiting_message';
  now: number;
}

export interface CommitSubagentToolProposalCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  delegationId: string;
  workId: string;
  ownerEpoch: number;
  modelStepId: string;
  attemptId: string;
  expectedRunVersion: number;
  providerCallId: string;
  toolCallId: string;
  toolName: string;
  toolVersion: string;
  inspection: ToolInspection;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costMicros: number;
  estimatedUsage: boolean;
  priceVersion: string | null;
  finishReason: string | null;
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
  costMicros: number;
  estimatedUsage: boolean;
  priceVersion: string | null;
  finishReason: string | null;
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
  costMicros?: number | null;
  priceVersion?: string | null;
  errorCode: string;
  now: number;
}

export interface RetryModelStepResult extends StateCommitResult {
  attemptId: string;
  attemptIndex: number;
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
  costMicros?: number | null;
  priceVersion?: string | null;
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
  costMicros?: number | null;
  priceVersion?: string | null;
  finishReason?: string | null;
  errorCode?: string;
  terminalStatus: 'completed_unverified' | 'failed' | 'cancelled';
  now: number;
}

export interface AtomicAppendInput {
  scope: Scope;
  runId: string;
  inputEntryId: string;
  input: UserInputData;
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

export interface CommitToolProposalCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  modelStepId: string;
  attemptId: string;
  expectedRunVersion: number;
  providerCallId: string;
  toolCallId: string;
  toolName: string;
  toolVersion: string;
  argumentsJson: string;
  assistantEntryId: string;
  assistantText: string;
  inspection: ToolInspection;
  usage: RunUsage;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  estimatedUsage?: boolean;
  costMicros?: number | null;
  priceVersion?: string | null;
  finishReason?: string | null;
  now: number;
}

export interface CommitToolProposalResult extends StateCommitResult {
  toolStepId: string;
  toolCallId: string;
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
  now: number;
}

export interface BeginReadToolCommand {
  scope: Scope;
  runId: string;
  runtimeId: string;
  toolStepId: string;
  toolCallId: string;
  expectedRunVersion: number;
  now: number;
}

export interface SettleReadToolCommand {
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
}

export interface SettleMutationToolCommand extends SettleReadToolCommand {
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
  costMicros?: number | null;
  priceVersion?: string | null;
  now: number;
}

export interface InterruptUnexpectedRootExecutionCommand {
  scope: Scope;
  runId: string;
  errorCode: string;
  now: number;
}

export interface StateCommitPort {
  createRun(command: AtomicCreateRun): Promise<CreateRunCommitResult>;
  appendInput(command: AtomicAppendInput): Promise<AppendInputCommitResult>;
  setRunGoal(command: AtomicSetRunGoal): Promise<SetRunGoalCommitResult>;
  cancelRun(command: AtomicCancelRun): Promise<CancelRunCommitResult>;
  increaseRunBudget(command: AtomicIncreaseRunBudget): Promise<IncreaseRunBudgetCommitResult>;
  deleteRun(command: AtomicDeleteRun): Promise<DeleteRunCommitResult>;
  beginModelStep(command: BeginModelStepCommand): Promise<BeginModelStepResult>;
  beginSubagentModelStep(command: BeginSubagentModelStepCommand): Promise<BeginModelStepResult>;
  pauseRuntimeForBudget(command: PauseRuntimeForBudgetCommand): Promise<StateCommitResult>;
  parkRuntime(command: ParkRuntimeCommand): Promise<StateCommitResult>;
  parkModelStep(command: ParkModelStepCommand): Promise<StateCommitResult>;
  commitSubagentToolProposal(command: CommitSubagentToolProposalCommand): Promise<CommitToolProposalResult>;
  beginSubagentTool(command: BeginSubagentToolCommand): Promise<StateCommitResult>;
  settleSubagentTool(command: SettleSubagentToolCommand): Promise<StateCommitResult>;
  settleSubagentWithoutModel(command: SettleSubagentWithoutModelCommand): Promise<StateCommitResult>;
  settleSubagentModelStep(command: SettleSubagentModelStepCommand): Promise<StateCommitResult>;
  retryModelStep(command: RetryModelStepCommand): Promise<RetryModelStepResult>;
  pauseModelStepForBudget(command: PauseModelStepForBudgetCommand): Promise<StateCommitResult>;
  settleModelStep(command: SettleModelStepCommand): Promise<StateCommitResult>;
  commitToolProposal(command: CommitToolProposalCommand): Promise<CommitToolProposalResult>;
  requestToolApproval(command: RequestToolApprovalCommand): Promise<StateCommitResult>;
  resolveToolApproval(command: ResolveToolApprovalCommand): Promise<StateCommitResult>;
  supersedeMutationTool(command: SupersedeMutationToolCommand): Promise<StateCommitResult>;
  expireToolApprovals(now: number): Promise<RunView[]>;
  beginReadTool(command: BeginReadToolCommand): Promise<StateCommitResult>;
  beginMutationTool(command: BeginMutationToolCommand): Promise<StateCommitResult>;
  settleReadTool(command: SettleReadToolCommand): Promise<StateCommitResult>;
  settleMutationTool(command: SettleMutationToolCommand): Promise<StateCommitResult>;
  supersedeModelStep(command: SupersedeModelStepCommand): Promise<StateCommitResult>;
  commit(command: StateCommitCommand): Promise<StateCommitResult>;
  interruptUnexpectedRootExecution(command: InterruptUnexpectedRootExecutionCommand): Promise<StateCommitResult | null>;
  quiesceApp(appId: string, now: number): Promise<number>;
  interruptNonTerminalRuns(now: number): Promise<number>;
}

export type RunCommandCommitPort = Pick<
  StateCommitPort,
  'createRun' | 'appendInput' | 'setRunGoal' | 'cancelRun' | 'increaseRunBudget' | 'deleteRun'
>;

export type RunCreationCommitPort = Pick<StateCommitPort, 'createRun'>;
export type ApprovalDecisionCommitPort = Pick<StateCommitPort, 'resolveToolApproval'>;
export type ApprovalSweepCommitPort = Pick<StateCommitPort, 'expireToolApprovals'>;
export type ProjectionCommitPort = Pick<StateCommitPort, 'commit'>;

export type CollaborationCommitPort = Pick<
  StateCommitPort,
  | 'beginSubagentModelStep'
  | 'beginSubagentTool'
  | 'commitSubagentToolProposal'
  | 'settleSubagentModelStep'
  | 'settleSubagentTool'
  | 'settleSubagentWithoutModel'
>;

export type RootExecutionCommitPort = Pick<
  StateCommitPort,
  | 'beginModelStep'
  | 'beginMutationTool'
  | 'beginReadTool'
  | 'commit'
  | 'commitToolProposal'
  | 'interruptUnexpectedRootExecution'
  | 'parkModelStep'
  | 'parkRuntime'
  | 'pauseModelStepForBudget'
  | 'pauseRuntimeForBudget'
  | 'requestToolApproval'
  | 'retryModelStep'
  | 'settleModelStep'
  | 'settleMutationTool'
  | 'settleReadTool'
  | 'supersedeModelStep'
  | 'supersedeMutationTool'
>;
