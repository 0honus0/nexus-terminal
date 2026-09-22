import type { ClockPort, JsonValue } from '../../agent.types';
import type { RootExecutionCommitPort } from '../runs/state-commit.port';
import type { RunSnapshot, RunUsage, RunView } from '../runs/run.types';

export class RootRunLifecycleCoordinator {
  constructor(
    private readonly stateCommit: RootExecutionCommitPort,
    private readonly clock: ClockPort,
  ) {}

  retryBudgetReason(run: RunView, usage: RunUsage): JsonValue | null {
    const activeExecutionSeconds =
      run.activeExecutionSeconds +
      (run.executingRuntimeCount > 0 && run.activeExecutionStartedAt !== null
        ? Math.max(0, this.clock.nowUnixSeconds() - run.activeExecutionStartedAt)
        : 0);
    const reason = activeExecutionSeconds >= run.budget.maxActiveExecutionSeconds ? 'active_time_limit' : null;
    if (!reason) return null;
    return {
      reason,
      retry: true,
      currentSteps: usage.steps,
      requestedSteps: usage.steps + 1,
      activeExecutionSeconds,
      maxActiveExecutionSeconds: run.budget.maxActiveExecutionSeconds,
    };
  }

  async reserveModelBudget(
    snapshot: RunSnapshot,
  ): Promise<Awaited<ReturnType<RootExecutionCommitPort['commit']>> | null> {
    const activeSeconds =
      snapshot.activeExecutionSeconds +
      (snapshot.executingRuntimeCount > 0 && snapshot.activeExecutionStartedAt !== null
        ? Math.max(0, this.clock.nowUnixSeconds() - snapshot.activeExecutionStartedAt)
        : 0);
    const reason =
      snapshot.usage.steps >= snapshot.budget.maxRunSteps
        ? 'step_limit'
        : activeSeconds >= snapshot.budget.maxActiveExecutionSeconds
          ? 'active_time_limit'
          : null;
    if (!reason) return null;

    const now = this.clock.nowUnixSeconds();
    return this.stateCommit.commit({
      scope: { userId: snapshot.userId, appId: snapshot.appId },
      runId: snapshot.id,
      expectedRunVersion: snapshot.version,
      events: [
        {
          type: 'budget.increase_requested',
          payload: {
            reason,
            currentSteps: snapshot.usage.steps,
            requestedSteps: snapshot.usage.steps + 1,
            activeExecutionSeconds: activeSeconds,
            maxActiveExecutionSeconds: snapshot.budget.maxActiveExecutionSeconds,
          },
        },
        { type: 'run.status_changed', payload: { from: snapshot.status, to: 'awaiting_budget' } },
      ],
      runPatch: { status: 'awaiting_budget' },
      now,
    });
  }

  async failAtSafeBoundary(
    snapshot: RunSnapshot | RunView,
    code: string,
  ): Promise<Awaited<ReturnType<RootExecutionCommitPort['commit']>>> {
    const now = this.clock.nowUnixSeconds();
    return this.stateCommit.commit({
      scope: { userId: snapshot.userId, appId: snapshot.appId },
      runId: snapshot.id,
      expectedRunVersion: snapshot.version,
      events: [
        { type: 'run.error', payload: { code } },
        { type: 'run.status_changed', payload: { from: snapshot.status, to: 'failed' } },
      ],
      runPatch: {
        status: 'failed',
        goalStatus: 'not_satisfied',
        verificationStatus: 'failed',
        completedAt: now,
      },
      now,
    });
  }

  async cancelAtSafeBoundary(
    snapshot: RunSnapshot | RunView,
  ): Promise<Awaited<ReturnType<RootExecutionCommitPort['commit']>>> {
    const now = this.clock.nowUnixSeconds();
    return this.stateCommit.commit({
      scope: { userId: snapshot.userId, appId: snapshot.appId },
      runId: snapshot.id,
      expectedRunVersion: snapshot.version,
      events: [
        { type: 'run.cancelled', payload: { reason: 'abort_signal' } },
        { type: 'run.status_changed', payload: { from: snapshot.status, to: 'cancelled' } },
      ],
      runPatch: { status: 'cancelled', completedAt: now },
      now,
    });
  }
}
