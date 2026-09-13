import { randomUUID } from 'node:crypto';
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
  BeginModelStepResult,
  BeginSubagentModelStepCommand,
  BeginSubagentToolCommand,
  SettleSubagentModelStepCommand,
  SettleSubagentToolCommand,
  SettleSubagentWithoutModelCommand,
  BeginReadToolCommand,
  BeginMutationToolCommand,
  CancelRunCommitResult,
  CommitSubagentToolProposalCommand,
  CommitToolProposalCommand,
  CommitToolProposalResult,
  CreateRunCommitResult,
  DeleteRunCommitResult,
  DurableEventInput,
  IncreaseRunBudgetCommitResult,
  MutatePendingInputCommitResult,
  SetRunGoalCommitResult,
  InterruptUnexpectedRootExecutionCommand,
  PauseModelStepForBudgetCommand,
  PauseRuntimeForBudgetCommand,
  ParkModelStepCommand,
  ParkRuntimeCommand,
  RetryModelStepCommand,
  RetryModelStepResult,
  RequestToolApprovalCommand,
  ResolveToolApprovalCommand,
  SettleModelStepCommand,
  SettleReadToolCommand,
  SettleMutationToolCommand,
  StateCommitCommand,
  StateCommitPort,
  StateCommitResult,
  SupersedeModelStepCommand,
  SupersedeMutationToolCommand,
} from '../../../modules/agent/runtime/runs/state-commit.port';
import type { RunStatus, RunView } from '../../../modules/agent/runtime/runs/run.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import { mapRunRow, RUN_COLUMNS, type RunRow } from '../repositories/sqlite-run.mapper';
import {
  beginModelStepTransition,
  parkModelStepTransition,
  pauseModelStepForBudgetTransition,
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
} from './state-commit/run-transitions';
import { setRunGoalTransition } from './state-commit/goal-transitions';
import { appendInputTransition } from './state-commit/input-transitions';
import { mutatePendingInputTransition } from './state-commit/pending-input-transitions';
import {
  beginSubagentModelStepTransition,
  beginSubagentToolTransition,
  commitSubagentToolProposalTransition,
  parkRuntimeTransition,
  pauseRuntimeForBudgetTransition,
  settleSubagentModelStepTransition,
  settleSubagentToolTransition,
  settleSubagentWithoutModelTransition,
} from './state-commit/subagent-transitions';
import {
  beginMutationToolTransition,
  beginReadToolTransition,
  commitToolProposalTransition,
  settleMutationToolTransition,
  settleReadToolTransition,
  supersedeMutationToolTransition,
} from './state-commit/tool-transitions';

export class SqliteStateCommitAdapter implements StateCommitPort {
  constructor(private readonly db: RelationalDatabase) {}

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
    return this.db.transaction((tx) => cancelRunTransition(tx, command));
  }

  async increaseRunBudget(command: AtomicIncreaseRunBudget): Promise<IncreaseRunBudgetCommitResult> {
    return this.db.transaction((tx) => increaseRunBudgetTransition(tx, command));
  }

  async deleteRun(command: AtomicDeleteRun): Promise<DeleteRunCommitResult> {
    return this.db.transaction((tx) => deleteRunTransition(tx, command));
  }

  async beginModelStep(command: BeginModelStepCommand): Promise<BeginModelStepResult> {
    return this.db.transaction((tx) => beginModelStepTransition(tx, command));
  }

  async beginSubagentModelStep(command: BeginSubagentModelStepCommand): Promise<BeginModelStepResult> {
    return this.db.transaction((tx) => beginSubagentModelStepTransition(tx, command));
  }

  async pauseRuntimeForBudget(command: PauseRuntimeForBudgetCommand): Promise<StateCommitResult> {
    return this.db.transaction((tx) => pauseRuntimeForBudgetTransition(tx, command));
  }

  async parkRuntime(command: ParkRuntimeCommand): Promise<StateCommitResult> {
    return this.db.transaction((tx) => parkRuntimeTransition(tx, command));
  }

  async parkModelStep(command: ParkModelStepCommand): Promise<StateCommitResult> {
    return this.db.transaction((tx) => parkModelStepTransition(tx, command));
  }

  async commitSubagentToolProposal(command: CommitSubagentToolProposalCommand): Promise<CommitToolProposalResult> {
    return this.db.transaction((tx) => commitSubagentToolProposalTransition(tx, command));
  }

  async beginSubagentTool(command: BeginSubagentToolCommand): Promise<StateCommitResult> {
    return this.db.transaction((tx) => beginSubagentToolTransition(tx, command));
  }

  async settleSubagentTool(command: SettleSubagentToolCommand): Promise<StateCommitResult> {
    return this.db.transaction((tx) => settleSubagentToolTransition(tx, command));
  }

  async settleSubagentWithoutModel(command: SettleSubagentWithoutModelCommand): Promise<StateCommitResult> {
    return this.db.transaction((tx) => settleSubagentWithoutModelTransition(tx, command));
  }

  async settleSubagentModelStep(command: SettleSubagentModelStepCommand): Promise<StateCommitResult> {
    return this.db.transaction((tx) => settleSubagentModelStepTransition(tx, command));
  }

  async retryModelStep(command: RetryModelStepCommand): Promise<RetryModelStepResult> {
    return this.db.transaction((tx) => retryModelStepTransition(tx, command));
  }

  async pauseModelStepForBudget(command: PauseModelStepForBudgetCommand): Promise<StateCommitResult> {
    return this.db.transaction((tx) => pauseModelStepForBudgetTransition(tx, command));
  }

  async settleModelStep(command: SettleModelStepCommand): Promise<StateCommitResult> {
    return this.db.transaction((tx) => settleModelStepTransition(tx, command));
  }

  async commitToolProposal(command: CommitToolProposalCommand): Promise<CommitToolProposalResult> {
    return this.db.transaction((tx) => commitToolProposalTransition(tx, command));
  }

  async requestToolApproval(command: RequestToolApprovalCommand): Promise<StateCommitResult> {
    return this.db.transaction((tx) => requestToolApprovalTransition(tx, command));
  }

  async resolveToolApproval(command: ResolveToolApprovalCommand): Promise<StateCommitResult> {
    return this.db.transaction((tx) => resolveToolApprovalTransition(tx, command));
  }

  async expireToolApprovals(now: number): Promise<RunView[]> {
    return this.db.transaction((tx) => expireToolApprovalsTransition(tx, now));
  }

  async supersedeMutationTool(command: SupersedeMutationToolCommand): Promise<StateCommitResult> {
    return this.db.transaction((tx) => supersedeMutationToolTransition(tx, command));
  }

  async beginMutationTool(command: BeginMutationToolCommand): Promise<StateCommitResult> {
    return this.db.transaction((tx) => beginMutationToolTransition(tx, command));
  }

  async settleMutationTool(command: SettleMutationToolCommand): Promise<StateCommitResult> {
    return this.db.transaction((tx) => settleMutationToolTransition(tx, command));
  }

  async beginReadTool(command: BeginReadToolCommand): Promise<StateCommitResult> {
    return this.db.transaction((tx) => beginReadToolTransition(tx, command));
  }

  async settleReadTool(command: SettleReadToolCommand): Promise<StateCommitResult> {
    return this.db.transaction((tx) => settleReadToolTransition(tx, command));
  }

  async supersedeModelStep(command: SupersedeModelStepCommand): Promise<StateCommitResult> {
    return this.db.transaction((tx) => supersedeModelStepTransition(tx, command));
  }

  async commit(command: StateCommitCommand): Promise<StateCommitResult> {
    validateEvents(command.events);
    return this.db.transaction(async (tx) => {
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
        if (!app || app.policy_revision !== command.expectedPolicyRevision) throw new Error('POLICY_REVISION_CONFLICT');
      }
      const ledgerCursor = await appendLedger(tx, row, command.ledgerAppends ?? [], command.now);
      const committedEvents = await appendEvents(tx, row, command.events, command.now);
      const oldLive = COUNTED_LIVE.has(row.status);
      const nextStatus = command.runPatch.status ?? row.status;
      const newLive = COUNTED_LIVE.has(nextStatus);
      const updatedRow = await patchRun(tx, row, command.runPatch, command.events.length, command.now);
      if (oldLive !== newLive) await updateAppLiveCount(tx, row.user_id, row.app_id, newLive ? 1 : -1, command.now);
      const run = mapRunRow(updatedRow);
      await allocateHostEvent(tx, row.user_id, 'summary.changed', summaryPayload(run), command.now);
      return { run, eventCursor: run.eventCursor, ledgerCursor, committedEvents };
    });
  }

  async interruptUnexpectedRootExecution(
    command: InterruptUnexpectedRootExecutionCommand,
  ): Promise<StateCommitResult | null> {
    return this.db.transaction(async (tx) => {
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
      const needsReconciliation = (unknownMutation?.count ?? 0) > 0;
      const events: DurableEventInput[] = [
        { type: 'run.error', payload: { code: command.errorCode } },
        {
          type: 'run.interrupted',
          payload: {
            reason: 'execution_boundary_error',
            errorCode: command.errorCode,
            needsReconciliation,
          },
        },
        { type: 'run.status_changed', payload: { from: row.status, to: 'interrupted' } },
      ];
      const committedEvents = await appendEvents(tx, row, events, command.now);
      const updatedRow = await patchRun(
        tx,
        row,
        { status: 'interrupted', needsReconciliation, completedAt: command.now },
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
      return { run, eventCursor: run.eventCursor, ledgerCursor: 0, committedEvents };
    });
  }

  async quiesceApp(appId: string, now: number): Promise<number> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.queryAll<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs
         WHERE app_id = ? AND status IN ('created','running','awaiting_approval','awaiting_budget','cancelling')
         ORDER BY created_at, id`,
        [appId],
      );
      for (const row of rows) {
        const nextStatus: RunStatus =
          row.status === 'running' || row.status === 'cancelling' ? 'interrupted' : 'cancelled';
        const events: DurableEventInput[] = [
          {
            type: nextStatus === 'interrupted' ? 'run.interrupted' : 'run.cancelled',
            payload: { reason: 'app_disabled', needsReconciliation: false },
          },
          { type: 'run.status_changed', payload: { from: row.status, to: nextStatus } },
        ];
        await appendEvents(tx, row, events, now);
        const changed = await tx.execute(
          `UPDATE agent_runs SET status = ?, needs_reconciliation = 0, completed_at = ?, updated_at = ?,
             version = version + 1, executing_runtime_count = 0, active_execution_started_at = NULL,
             next_event_sequence = next_event_sequence + ?
           WHERE id = ? AND version = ?`,
          [nextStatus, now, now, events.length, row.id, row.version],
        );
        if (changed.changes !== 1) throw new Error('STATE_CONFLICT');
        await tx.execute(
          `UPDATE agent_runtimes SET status = ?, updated_at = ?
           WHERE run_id = ? AND status IN ('created','running','stopping')`,
          [nextStatus === 'interrupted' ? 'interrupted' : 'stopped', now, row.id],
        );
        if (COUNTED_LIVE.has(row.status)) await updateAppLiveCount(tx, row.user_id, row.app_id, -1, now);
        const updated = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
        if (updated)
          await allocateHostEvent(tx, row.user_id, 'summary.changed', summaryPayload(mapRunRow(updated)), now);
      }
      return rows.length;
    });
  }

  async interruptNonTerminalRuns(now: number): Promise<number> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.queryAll<RunRow>(
        `SELECT ${RUN_COLUMNS} FROM agent_runs
         WHERE status IN ('created','running','awaiting_approval','awaiting_budget','cancelling')
         ORDER BY created_at, id`,
      );
      for (const row of rows) {
        const unknownMutation = await tx.queryOne<{ count: number }>(
          `SELECT COUNT(*) AS count FROM agent_tool_calls
           WHERE run_id = ? AND risk <> 'read' AND status IN ('running','reconciling')`,
          [row.id],
        );
        const needsReconciliation = (unknownMutation?.count ?? 0) > 0;
        const events: DurableEventInput[] = [
          { type: 'run.interrupted', payload: { reason: 'backend_restart', needsReconciliation } },
          { type: 'run.status_changed', payload: { from: row.status, to: 'interrupted' } },
        ];
        await appendEvents(tx, row, events, now);
        const changed = await tx.execute(
          `UPDATE agent_runs SET status = 'interrupted', needs_reconciliation = ?, completed_at = ?, updated_at = ?,
             version = version + 1, executing_runtime_count = 0, active_execution_started_at = NULL,
             next_event_sequence = next_event_sequence + ?
           WHERE id = ? AND version = ?`,
          [needsReconciliation ? 1 : 0, now, now, events.length, row.id, row.version],
        );
        if (changed.changes !== 1) throw new Error('STATE_CONFLICT');

        const approvalsChanged = await tx.execute(
          `UPDATE agent_approvals SET status = 'superseded', decided_at = ?, version = version + 1
           WHERE run_id = ? AND user_id = ? AND app_id = ? AND status = 'requested'`,
          [now, row.id, row.user_id, row.app_id],
        );
        if (approvalsChanged.changes > 0) {
          await tx.execute(
            `UPDATE agent_apps SET approval_count = MAX(0, approval_count - ?), updated_at = ?
             WHERE user_id = ? AND app_id = ?`,
            [approvalsChanged.changes, now, row.user_id, row.app_id],
          );
        }
        if (row.status === 'awaiting_budget') {
          await tx.execute(
            `UPDATE agent_apps SET budget_request_count = MAX(0, budget_request_count - 1), updated_at = ?
             WHERE user_id = ? AND app_id = ?`,
            [now, row.user_id, row.app_id],
          );
        }

        await tx.execute(
          `UPDATE agent_tool_calls SET status = 'cancelled', completed_at = ?, version = version + 1
           WHERE run_id = ? AND status = 'awaiting_approval'`,
          [now, row.id],
        );
        await tx.execute(
          `UPDATE agent_steps SET status = 'cancelled', completed_at = ?
           WHERE run_id = ? AND kind = 'tool' AND status = 'created'`,
          [now, row.id],
        );
        await tx.execute(
          `UPDATE agent_runtimes SET status = 'interrupted', schedule_state = 'finished', updated_at = ?
           WHERE run_id = ? AND status IN ('created','running','stopping','interrupted')`,
          [now, row.id],
        );
        await tx.execute(
          `UPDATE agent_scheduler_work SET status = 'cancelled', owner_epoch = NULL, version = version + 1, updated_at = ?
           WHERE run_id = ? AND status IN ('queued','claimed','waiting')`,
          [now, row.id],
        );
        if (COUNTED_LIVE.has(row.status)) await updateAppLiveCount(tx, row.user_id, row.app_id, -1, now);
        const updated = await tx.queryOne<RunRow>(`SELECT ${RUN_COLUMNS} FROM agent_runs WHERE id = ?`, [row.id]);
        if (updated)
          await allocateHostEvent(tx, row.user_id, 'summary.changed', summaryPayload(mapRunRow(updated)), now);
      }
      return rows.length;
    });
  }
}
