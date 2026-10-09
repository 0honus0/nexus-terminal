import { randomUUID } from 'node:crypto';
import { partialExecutionReport } from '../../../modules/agent/runtime/execution/runtime-progress';
import { settleInterruptedRunChildren } from './state-commit/recovery-transitions';
import { cancelRunSubagentWork } from './state-commit/transaction-primitives';
import {
	advanceExecutionBudgetTransition,
	type AdvanceExecutionBudgetCommand,
} from './state-commit/execution-budget-transitions';
import type { Scope } from '../../../modules/agent/agent.types';
import type {
	AppendInputCommitResult,
	AtomicAppendInput,
	AtomicCancelRun,
	AtomicCreateRun,
	AtomicDeleteRun,
	AtomicIncreaseRunBudget,
	AtomicMutatePendingInput,
	AtomicSetRunGoal,
	BeginModelStepCommand,
	CompleteCompactionStepCommand,
	CompleteCompactionStepResult,
	BeginModelStepResult,
	BeginReadToolBatchCommand,
	BeginSubagentMutationToolCommand,
	BeginSubagentModelStepCommand,
	BeginSubagentToolCommand,
	SettleSubagentModelStepCommand,
	SettleSubagentToolCommand,
	SettleSubagentWithoutModelCommand,
	BeginMutationToolCommand,
	CancelRunCommitResult,
	CloseAcpPermissionApprovalCommand,
	CommitSubagentToolProposalBatchCommand,
	CommitToolProposalBatchCommand,
	CommitToolProposalBatchResult,
	ChangeModelRouteCommand,
	ChangeModelRouteResult,
	ContinueModelStepForCompletionGateCommand,
	CreateRunCommitResult,
	DeleteRunCommitResult,
	DurableEventInput,
	EvaluateToolLoopGuardCommand,
	IncreaseRunBudgetCommitResult,
	MutatePendingInputCommitResult,
	SetRunGoalCommitResult,
	InterruptUnexpectedRootExecutionCommand,
	PauseRuntimeForBudgetCommand,
	ParkMcpInputRequiredToolCommand,
	ParkModelStepCommand,
	ParkRuntimeCommand,
	RetryModelStepCommand,
	RetryModelStepResult,
	RequestToolApprovalCommand,
	RequestAcpPermissionApprovalCommand,
	RefreshProposedToolCommand,
	RejectProposedToolCommand,
	ResolveRunReconciliationCommand,
	ResolveToolApprovalCommand,
	SettleModelStepCommand,
	SettleReadToolBatchCommand,
	SettleUserInputRequestToolCommand,
	SettleMutationToolCommand,
	StateCommitCommand,
	StateCommitPort,
	StateCommitResult,
	SupersedeModelStepCommand,
	SupersedeMutationToolCommand,
} from '../../../modules/agent/runtime/runs/state-commit.port';
import type { RunEvent, RunView } from '../../../modules/agent/runtime/runs/run.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import { cleanupExpiredCommittedCommands } from '../idempotency/command-lifecycle';
import { mapRunRow, RUN_COLUMNS, type RunRow } from '../repositories/sqlite-run.mapper';
import {
	beginModelStepTransition,
	continueModelStepForCompletionGateTransition,
	parkModelStepTransition,
	retryModelStepTransition,
	settleModelStepTransition,
	supersedeModelStepTransition,
} from './state-commit/model-transitions';
import {
	expireToolApprovalsTransition,
	requestToolApprovalTransition,
	resolveToolApprovalTransition,
} from './state-commit/approval-transitions';
import {
	closeAcpPermissionApprovalTransition,
	requestAcpPermissionApprovalTransition,
} from './state-commit/acp-permission-approval-transitions';
import {
	allocateHostEvent,
	appendEvents,
	appendLedger,
	COUNTED_LIVE,
	patchRun,
	summaryPayload,
	updateAppLiveCount,
	validateEvents,
} from './state-commit/transaction-primitives';
import {
	cancelRunTransition,
	createRunTransition,
	deleteRunTransition,
	increaseRunBudgetTransition,
	resolveRunReconciliationTransition,
} from './state-commit/run-transitions';
import {
	quiesceAppTransition,
	interruptNonTerminalRunsTransition,
	findRestartRecoveryCandidates,
	supersedeUnconsumedRunApprovals,
} from './state-commit/recovery-transitions';
import { setRunGoalTransition } from './state-commit/goal-transitions';
import { completeCompactionStepTransition } from './state-commit/compaction-transitions';
import { appendInputTransition } from './state-commit/input-transitions';
import { mutatePendingInputTransition } from './state-commit/pending-input-transitions';
import { evaluateLoopGuard } from './state-commit/loop-guard';
import {
	beginSubagentMutationToolTransition,
	beginSubagentModelStepTransition,
	beginSubagentToolTransition,
	commitSubagentToolProposalBatchTransition,
	parkRuntimeTransition,
	pauseRuntimeForBudgetTransition,
	settleSubagentModelStepTransition,
	settleSubagentToolTransition,
	settleSubagentWithoutModelTransition,
} from './state-commit/subagent-transitions';
import {
	beginMutationToolTransition,
	beginReadToolBatchTransition,
	commitToolProposalBatchTransition,
	parkMcpInputRequiredToolTransition,
	refreshProposedToolTransition,
	rejectProposedToolTransition,
	settleMutationToolTransition,
	settleReadToolBatchTransition,
	settleUserInputRequestToolTransition,
	supersedeMutationToolTransition,
} from './state-commit/tool-transitions';

export type AgentDurableCommitObserver = (run: RunView, events: readonly RunEvent[]) => void;

export class SqliteStateCommitAdapter implements StateCommitPort {
	constructor(
		private readonly db: RelationalDatabase,
		private readonly onDurableCommit: AgentDurableCommitObserver = () => undefined,
	) {}

	private notify(run: RunView, events: readonly RunEvent[]): void {
		if (events.length === 0) return;
		try {
			this.onDurableCommit(run, events);
		} catch {
			// Observation is a post-commit projection. It must never invalidate durable Agent state.
		}
	}

	private observe<T extends { run: RunView; committedEvents: RunEvent[] }>(result: T): T {
		this.notify(result.run, result.committedEvents);
		return result;
	}

	private async observedTransaction<T extends { run: RunView; committedEvents: RunEvent[] }>(
		work: (tx: RelationalDatabase) => Promise<T>,
	): Promise<T> {
		return this.observe(await this.db.transaction(work));
	}

	async createRun(command: AtomicCreateRun): Promise<CreateRunCommitResult> {
		return this.db.transaction((tx) => createRunTransition(tx, command));
	}

	async appendInput(command: AtomicAppendInput): Promise<AppendInputCommitResult> {
		return this.db.transaction((tx) => appendInputTransition(tx, command));
	}

	async mutatePendingInput(command: AtomicMutatePendingInput): Promise<MutatePendingInputCommitResult> {
		return this.db.transaction((tx) => mutatePendingInputTransition(tx, command));
	}

	async setRunGoal(command: AtomicSetRunGoal): Promise<SetRunGoalCommitResult> {
		return this.db.transaction((tx) => setRunGoalTransition(tx, command));
	}

	async cancelRun(command: AtomicCancelRun): Promise<CancelRunCommitResult> {
		return this.observedTransaction((tx) => cancelRunTransition(tx, command));
	}

	async increaseRunBudget(command: AtomicIncreaseRunBudget): Promise<IncreaseRunBudgetCommitResult> {
		return this.db.transaction((tx) => increaseRunBudgetTransition(tx, command));
	}

	async deleteRun(command: AtomicDeleteRun): Promise<DeleteRunCommitResult> {
		return this.db.transaction((tx) => deleteRunTransition(tx, command));
	}

	async resolveRunReconciliation(command: ResolveRunReconciliationCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => resolveRunReconciliationTransition(tx, command));
	}

	async supersedeRunApprovals(scope: Scope, runId: string, now: number): Promise<number> {
		return this.db.transaction(async (tx) => {
			const row = await tx.queryOne<RunRow>(
				`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
				[runId, scope.userId, scope.appId],
			);
			if (!row) throw new Error('NOT_FOUND');
			if (
				['created', 'running', 'awaiting_approval', 'awaiting_budget', 'awaiting_input', 'cancelling'].includes(
					row.status,
				)
			) {
				throw new Error('RUN_NOT_TERMINAL');
			}
			return supersedeUnconsumedRunApprovals(tx, row, now);
		});
	}

	async advanceExecutionBudget(command: AdvanceExecutionBudgetCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => advanceExecutionBudgetTransition(tx, command));
	}

	async beginModelStep(command: BeginModelStepCommand): Promise<BeginModelStepResult> {
		return this.observedTransaction((tx) => beginModelStepTransition(tx, command));
	}

	async completeCompactionStep(command: CompleteCompactionStepCommand): Promise<CompleteCompactionStepResult> {
		return this.observedTransaction((tx) => completeCompactionStepTransition(tx, command));
	}

	async beginSubagentModelStep(command: BeginSubagentModelStepCommand): Promise<BeginModelStepResult> {
		return this.observedTransaction((tx) => beginSubagentModelStepTransition(tx, command));
	}

	async pauseRuntimeForBudget(command: PauseRuntimeForBudgetCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => pauseRuntimeForBudgetTransition(tx, command));
	}

	async parkRuntime(command: ParkRuntimeCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => parkRuntimeTransition(tx, command));
	}

	async parkModelStep(command: ParkModelStepCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => parkModelStepTransition(tx, command));
	}

	async continueModelStepForCompletionGate(
		command: ContinueModelStepForCompletionGateCommand,
	): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => continueModelStepForCompletionGateTransition(tx, command));
	}

	async commitSubagentToolProposalBatch(
		command: CommitSubagentToolProposalBatchCommand,
	): Promise<CommitToolProposalBatchResult> {
		return this.observedTransaction((tx) => commitSubagentToolProposalBatchTransition(tx, command));
	}

	async beginSubagentTool(command: BeginSubagentToolCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => beginSubagentToolTransition(tx, command));
	}

	async beginSubagentMutationTool(command: BeginSubagentMutationToolCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => beginSubagentMutationToolTransition(tx, command));
	}

	async settleSubagentTool(command: SettleSubagentToolCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => settleSubagentToolTransition(tx, command));
	}

	async settleSubagentWithoutModel(command: SettleSubagentWithoutModelCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => settleSubagentWithoutModelTransition(tx, command));
	}

	async settleSubagentModelStep(command: SettleSubagentModelStepCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => settleSubagentModelStepTransition(tx, command));
	}

	async retryModelStep(command: RetryModelStepCommand): Promise<RetryModelStepResult> {
		return this.observedTransaction((tx) => retryModelStepTransition(tx, command));
	}

	async changeModelRoute(command: ChangeModelRouteCommand): Promise<ChangeModelRouteResult> {
		const previousAttemptId = command.attemptId;
		const result = await this.observedTransaction((tx) =>
			retryModelStepTransition(tx, {
				...command,
				nextModel: command.toModel,
				routeChange: { from: command.fromModel, to: command.toModel, routeIndex: command.toRouteIndex },
			}),
		);
		return { ...result, previousAttemptId };
	}

	async settleModelStep(command: SettleModelStepCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => settleModelStepTransition(tx, command));
	}

	async commitToolProposalBatch(command: CommitToolProposalBatchCommand): Promise<CommitToolProposalBatchResult> {
		return this.observedTransaction((tx) => commitToolProposalBatchTransition(tx, command));
	}

	async refreshProposedTool(command: RefreshProposedToolCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => refreshProposedToolTransition(tx, command));
	}

	async rejectProposedTool(command: RejectProposedToolCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => rejectProposedToolTransition(tx, command));
	}

	async requestToolApproval(command: RequestToolApprovalCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => requestToolApprovalTransition(tx, command));
	}

	async requestAcpPermissionApproval(command: RequestAcpPermissionApprovalCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => requestAcpPermissionApprovalTransition(tx, command));
	}

	async closeAcpPermissionApproval(command: CloseAcpPermissionApprovalCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => closeAcpPermissionApprovalTransition(tx, command));
	}

	async resolveToolApproval(command: ResolveToolApprovalCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => resolveToolApprovalTransition(tx, command));
	}

	async expireToolApprovals(now: number): Promise<RunView[]> {
		return this.db.transaction((tx) => expireToolApprovalsTransition(tx, now));
	}

	async cleanupExpiredCommands(now: number, limit = 200): Promise<number> {
		return this.db.transaction((tx) => cleanupExpiredCommittedCommands(tx, now, limit));
	}

	async supersedeMutationTool(command: SupersedeMutationToolCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => supersedeMutationToolTransition(tx, command));
	}

	async beginMutationTool(command: BeginMutationToolCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => beginMutationToolTransition(tx, command));
	}

	async settleMutationTool(command: SettleMutationToolCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => settleMutationToolTransition(tx, command));
	}

	async beginReadToolBatch(command: BeginReadToolBatchCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => beginReadToolBatchTransition(tx, command));
	}

	async settleReadToolBatch(command: SettleReadToolBatchCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => settleReadToolBatchTransition(tx, command));
	}

	async parkMcpInputRequiredTool(command: ParkMcpInputRequiredToolCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => parkMcpInputRequiredToolTransition(tx, command));
	}

	async settleUserInputRequestTool(command: SettleUserInputRequestToolCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => settleUserInputRequestToolTransition(tx, command));
	}

	async evaluateToolLoopGuard(command: EvaluateToolLoopGuardCommand): Promise<StateCommitResult> {
		return this.observedTransaction(async (tx) => {
			const row = await tx.queryOne<RunRow>(
				`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
				[command.runId, command.scope.userId, command.scope.appId],
			);
			if (!row) throw new Error('NOT_FOUND');
			if (row.version !== command.expectedRunVersion || row.status !== 'running')
				throw new Error('STATE_CONFLICT');
			return evaluateLoopGuard(
				tx,
				row,
				command.runtimeId,
				command.delegationId ?? null,
				command.observations,
				command.now,
			);
		});
	}

	async supersedeModelStep(command: SupersedeModelStepCommand): Promise<StateCommitResult> {
		return this.observedTransaction((tx) => supersedeModelStepTransition(tx, command));
	}

	async commit(command: StateCommitCommand): Promise<StateCommitResult> {
		validateEvents(command.events);
		return this.observedTransaction(async (tx) => {
			const row = await tx.queryOne<RunRow>(
				`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
				[command.runId, command.scope.userId, command.scope.appId],
			);
			if (!row) throw new Error('NOT_FOUND');
			if (row.version !== command.expectedRunVersion) throw new Error('STATE_CONFLICT');
			if (command.expectedInputRevision !== undefined && row.input_revision !== command.expectedInputRevision) {
				throw new Error('INPUT_REVISION_CONFLICT');
			}
			if (command.expectedPolicyRevision !== undefined) {
				const app = await tx.queryOne<{ policy_revision: number }>(
					'SELECT policy_revision FROM agent_apps WHERE user_id = ? AND app_id = ?',
					[command.scope.userId, command.scope.appId],
				);
				if (!app || app.policy_revision !== command.expectedPolicyRevision)
					throw new Error('POLICY_REVISION_CONFLICT');
			}
			const ledgerCursor = await appendLedger(tx, row, command.ledgerAppends ?? [], command.now);
			const committedEvents = await appendEvents(tx, row, command.events, command.now);
			const oldLive = COUNTED_LIVE.has(row.status);
			const nextStatus = command.runPatch.status ?? row.status;
			const newLive = COUNTED_LIVE.has(nextStatus);
			const updatedRow = await patchRun(tx, row, command.runPatch, command.events.length, command.now);
			if (oldLive !== newLive)
				await updateAppLiveCount(tx, row.user_id, row.app_id, newLive ? 1 : -1, command.now);
			const run = mapRunRow(updatedRow);
			await allocateHostEvent(tx, row.user_id, 'summary.changed', summaryPayload(run), command.now);
			return { run, eventCursor: run.eventCursor, ledgerCursor, committedEvents };
		});
	}

	async interruptUnexpectedRootExecution(
		command: InterruptUnexpectedRootExecutionCommand,
	): Promise<StateCommitResult | null> {
		const result = await this.db.transaction(async (tx) => {
			const row = await tx.queryOne<RunRow>(
				`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
				[command.runId, command.scope.userId, command.scope.appId],
			);
			if (!row) throw new Error('NOT_FOUND');
			if (!['created', 'running'].includes(row.status)) return null;

			const unknownMutation = await tx.queryOne<{ count: number }>(
				`SELECT COUNT(*) AS count FROM agent_tool_calls
         WHERE run_id = ? AND risk <> 'read' AND status IN ('running','reconciling')`,
				[row.id],
			);
			const resourceStop = command.errorCode === 'RUN_EXECUTION_LIMIT';
			const childState = resourceStop
				? await settleInterruptedRunChildren(tx, row, command.now, 'execution_limit')
				: null;
			const needsReconciliation =
				row.needs_reconciliation === 1 ||
				(unknownMutation?.count ?? 0) > 0 ||
				Boolean(childState?.needsReconciliation);
			if (resourceStop) {
				await cancelRunSubagentWork(tx, row.id, command.now, true);
				await tx.execute(
					`UPDATE agent_runs SET active_execution_seconds = active_execution_seconds + ?, executing_runtime_count = 0, active_execution_started_at = NULL WHERE id = ?`,
					[
						row.active_execution_started_at === null
							? 0
							: Math.max(0, command.now - row.active_execution_started_at),
						row.id,
					],
				);
			}
			const events: DurableEventInput[] = [
				{ type: 'run.error', payload: { code: command.errorCode } },
				{
					type: 'run.interrupted',
					payload: {
						reason: resourceStop ? 'execution_limit' : 'execution_boundary_error',
						errorCode: command.errorCode,
						needsReconciliation,
					},
				},
				{ type: 'run.status_changed', payload: { from: row.status, to: 'interrupted' } },
			];
			const text = resourceStop ? partialExecutionReport(mapRunRow(row), command.now) : null;
			if (text)
				events.push({ type: 'message.final', payload: { text, partial: true, reason: 'execution_limit' } });
			const ledgerCursor = text
				? await appendLedger(
						tx,
						row,
						[
							{
								id: randomUUID(),
								runId: row.id,
								kind: 'assistant_message',
								payload: { text, partial: true, reason: 'execution_limit' },
							},
						],
						command.now,
					)
				: 0;
			const committedEvents = await appendEvents(tx, row, events, command.now);
			const updatedRow = await patchRun(
				tx,
				row,
				{
					status: 'interrupted',
					needsReconciliation,
					completedAt: command.now,
					...(resourceStop
						? { goalStatus: 'not_satisfied' as const, verificationStatus: 'unverified' as const }
						: {}),
				},
				events.length,
				command.now,
			);
			await tx.execute(
				`UPDATE agent_runtimes SET status = 'interrupted', schedule_state = 'finished', updated_at = ?
         WHERE run_id = ? AND status IN ('created','running','stopping')`,
				[command.now, row.id],
			);
			await tx.execute(
				`UPDATE agent_scheduler_work SET status = 'cancelled', owner_epoch = NULL, version = version + 1, updated_at = ?
         WHERE run_id = ? AND status IN ('queued','waiting')`,
				[command.now, row.id],
			);
			if (COUNTED_LIVE.has(row.status)) await updateAppLiveCount(tx, row.user_id, row.app_id, -1, command.now);
			const run = mapRunRow(updatedRow);
			await allocateHostEvent(tx, row.user_id, 'summary.changed', summaryPayload(run), command.now);
			return { run, eventCursor: run.eventCursor, ledgerCursor, committedEvents };
		});
		return result ? this.observe(result) : null;
	}

	async quiesceApp(scope: Scope, now: number): Promise<number> {
		const { count, observed } = await this.db.transaction((tx) => quiesceAppTransition(tx, scope, now));
		for (const item of observed) this.notify(item.run, item.events);
		return count;
	}

	async interruptNonTerminalRuns(now: number): Promise<RunView[]> {
		const observed = await this.db.transaction((tx) => interruptNonTerminalRunsTransition(tx, now));
		for (const item of observed) this.notify(item.run, item.events);
		return findRestartRecoveryCandidates(this.db, observed);
	}
}
