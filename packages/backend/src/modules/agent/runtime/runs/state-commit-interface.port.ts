import type { Scope } from '../../agent.types';
import type { RunView } from './run.types';
import type { StateCommitCommand, StateCommitResult } from './state-commit-common.contracts';
import type {
  BeginModelStepCommand,
  BeginModelStepResult,
  BeginSubagentModelStepCommand,
  BeginSubagentMutationToolCommand,
  BeginSubagentToolCommand,
  ChangeModelRouteCommand,
  ChangeModelRouteResult,
  CommitSubagentToolProposalBatchCommand,
  ContinueModelStepForCompletionGateCommand,
  InterruptUnexpectedRootExecutionCommand,
  ParkModelStepCommand,
  ParkRuntimeCommand,
  PauseModelStepForBudgetCommand,
  PauseRuntimeForBudgetCommand,
  RetryModelStepCommand,
  RetryModelStepResult,
  SettleModelStepCommand,
  SettleSubagentModelStepCommand,
  SettleSubagentToolCommand,
  SettleSubagentWithoutModelCommand,
  SupersedeModelStepCommand,
} from './state-commit-model.contracts';
import type {
  AppendInputCommitResult,
  AtomicAppendInput,
  AtomicCancelRun,
  AtomicCreateRun,
  AtomicDeleteRun,
  AtomicIncreaseRunBudget,
  AtomicMutatePendingInput,
  AtomicSetRunGoal,
  CancelRunCommitResult,
  CreateRunCommitResult,
  DeleteRunCommitResult,
  IncreaseRunBudgetCommitResult,
  MutatePendingInputCommitResult,
  ResolveRunReconciliationCommand,
  SetRunGoalCommitResult,
} from './state-commit-run.contracts';
import type {
  BeginMutationToolCommand,
  BeginReadToolBatchCommand,
  CloseAcpPermissionApprovalCommand,
  CommitToolProposalBatchCommand,
  CommitToolProposalBatchResult,
  EvaluateToolLoopGuardCommand,
  ParkMcpInputRequiredToolCommand,
  RefreshProposedToolCommand,
  RejectProposedToolCommand,
  RequestAcpPermissionApprovalCommand,
  RequestToolApprovalCommand,
  ResolveToolApprovalCommand,
  SettleMutationToolCommand,
  SettleReadToolBatchCommand,
  SettleUserInputRequestToolCommand,
  SupersedeMutationToolCommand,
} from './state-commit-tool.contracts';

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
  beginSubagentMutationTool(command: BeginSubagentMutationToolCommand): Promise<StateCommitResult>;
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
  requestAcpPermissionApproval(command: RequestAcpPermissionApprovalCommand): Promise<StateCommitResult>;
  closeAcpPermissionApproval(command: CloseAcpPermissionApprovalCommand): Promise<StateCommitResult>;
  resolveToolApproval(command: ResolveToolApprovalCommand): Promise<StateCommitResult>;
  supersedeMutationTool(command: SupersedeMutationToolCommand): Promise<StateCommitResult>;
  expireToolApprovals(now: number): Promise<RunView[]>;
  cleanupExpiredCommands(now: number, limit?: number): Promise<number>;
  beginReadToolBatch(command: BeginReadToolBatchCommand): Promise<StateCommitResult>;
  beginMutationTool(command: BeginMutationToolCommand): Promise<StateCommitResult>;
  settleReadToolBatch(command: SettleReadToolBatchCommand): Promise<StateCommitResult>;
  settleUserInputRequestTool(command: SettleUserInputRequestToolCommand): Promise<StateCommitResult>;
  parkMcpInputRequiredTool(command: ParkMcpInputRequiredToolCommand): Promise<StateCommitResult>;
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

export type AcpPermissionApprovalCommitPort = Pick<
  StateCommitPort,
  'requestAcpPermissionApproval' | 'closeAcpPermissionApproval'
>;

export type ApprovalSweepCommitPort = Pick<StateCommitPort, 'expireToolApprovals' | 'cleanupExpiredCommands'>;

export type ProjectionCommitPort = Pick<StateCommitPort, 'commit'>;

export type CollaborationCommitPort = Pick<
  StateCommitPort,
  | 'beginSubagentModelStep'
  | 'beginSubagentMutationTool'
  | 'beginSubagentTool'
  | 'commitSubagentToolProposalBatch'
  | 'commit'
  | 'refreshProposedTool'
  | 'requestToolApproval'
  | 'resolveToolApproval'
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
  | 'parkMcpInputRequiredTool'
  | 'evaluateToolLoopGuard'
  | 'supersedeModelStep'
  | 'supersedeMutationTool'
>;
