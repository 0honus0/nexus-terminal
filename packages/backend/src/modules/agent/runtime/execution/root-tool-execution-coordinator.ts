import type { ClockPort } from '../../agent.types';
import type { BackendSignal } from './agent-backend.port';
import type { PendingRootTool, RunExecutionReaderPort } from '../runs/run.repository.port';
import type { RootExecutionCommitPort } from '../runs/state-commit.port';
import type { RunSnapshot, RunView } from '../runs/run.types';
import { RootMutationExecutionAdapter } from './root-mutation-execution-adapter';
import { RootReadToolExecutor } from './root-read-tool-executor';
import { rejectedRootToolResult } from './root-tool-execution-common';
import { ToolCallRunner } from './tool-call-runner';

const signalReason = (signal: AbortSignal): string | null => {
  if (!signal.aborted) return null;
  const reason = signal.reason;
  if (reason instanceof Error) return reason.message;
  return typeof reason === 'string' ? reason : 'ABORTED';
};

export type RootToolExecutionDisposition = 'continue' | 'return';

/** Scheduler-facing Root Tool dispatch facade. */
export class RootToolExecutionCoordinator {
  private readonly reads: RootReadToolExecutor;
  private readonly mutations: RootMutationExecutionAdapter;

  constructor(
    repository: RunExecutionReaderPort,
    stateCommit: RootExecutionCommitPort,
    toolCalls: ToolCallRunner,
    clock: ClockPort,
    recoverySafePoint: (run: RunView, reason: 'model_boundary' | 'read_batch' | 'mutation_confirmed') => Promise<void>,
  ) {
    this.reads = new RootReadToolExecutor(repository, stateCommit, toolCalls, clock, (run) =>
      recoverySafePoint(run, 'read_batch'),
    );
    this.mutations = new RootMutationExecutionAdapter(repository, stateCommit, toolCalls, clock, (run) =>
      recoverySafePoint(run, 'mutation_confirmed'),
    );
  }

  async *execute(
    snapshot: RunSnapshot,
    pendingTools: readonly PendingRootTool[],
    signal: AbortSignal,
  ): AsyncGenerator<BackendSignal, RootToolExecutionDisposition> {
    const first = pendingTools[0];
    if (!first) return 'continue';

    if (snapshot.usage.steps >= snapshot.budget.maxRunSteps) {
      if (first.status === 'ready') {
        yield* this.mutations.supersedeForBudget(snapshot, first);
      } else {
        yield* this.reads.rejectPending(
          snapshot,
          first,
          rejectedRootToolResult(
            'RUN_STEP_BUDGET_EXHAUSTED',
            'The Run step budget was exhausted before this queued tool call could execute.',
          ),
        );
      }
      return 'continue';
    }

    if (first.status === 'ready') {
      yield* this.mutations.execute(snapshot, first, signal);
      return 'continue';
    }

    if (first.inspection.inputRevision !== snapshot.inputRevision) {
      yield* this.reads.refreshOrRejectSuperseded(snapshot, first, signal);
      return 'continue';
    }

    if (first.inspection.mutation) {
      const waiting = yield* this.mutations.prepare(snapshot, first, signal);
      return waiting ? 'return' : 'continue';
    }

    yield* this.reads.execute(snapshot, this.reads.selectWave(snapshot, pendingTools), signal);
    const pendingAbortReason = signalReason(signal);
    if (
      pendingAbortReason === 'NEW_INPUT' ||
      pendingAbortReason === 'GOAL_UPDATED' ||
      pendingAbortReason === 'AGENT_QUIESCE'
    ) {
      return 'return';
    }
    return 'continue';
  }
}
