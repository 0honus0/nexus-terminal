import type { ClockPort } from '../../modules/agent/agent.types';
import type { StateCommitPort } from '../../modules/agent/runtime/runs/state-commit.port';
import type { AgentScheduler } from '../../modules/agent/runtime/scheduling/scheduler';
import type { WorkspaceRuntimeService } from '../../modules/agent/workspace-runtime/workspace-runtime.service';

type SchedulerRun = Parameters<AgentScheduler['enqueue']>[0];

export interface AgentLifecycleSweeps {
  start(): void;
  stop(): Promise<void>;
}

export interface CreateAgentLifecycleSweepsOptions {
  stateCommit: StateCommitPort;
  workspaceRuntime: WorkspaceRuntimeService;
  scheduler: AgentScheduler;
  clock: ClockPort;
  notifyCommitted(run: SchedulerRun): void;
}

export const createAgentLifecycleSweeps = ({
  stateCommit,
  workspaceRuntime,
  scheduler,
  clock,
  notifyCommitted,
}: CreateAgentLifecycleSweepsOptions): AgentLifecycleSweeps => {
  let approvalExpiryTimer: NodeJS.Timeout | null = null;
  let approvalExpirySweep = Promise.resolve();
  let workspaceReconcileTimer: NodeJS.Timeout | null = null;
  let workspaceReconcileSweep = Promise.resolve();

  const sweepExpiredApprovals = (): void => {
    approvalExpirySweep = approvalExpirySweep
      .then(async () => {
        const resumed = await stateCommit.expireToolApprovals(clock.nowUnixSeconds());
        for (const run of resumed) {
          notifyCommitted(run);
          scheduler.enqueue(run);
        }
      })
      .catch((error) => console.error('[Agent] approval expiry sweep failed:', error));
  };

  const sweepWorkspaceReconciliation = (): void => {
    workspaceReconcileSweep = workspaceReconcileSweep
      .then(() => workspaceRuntime.reconcile())
      .then(() => undefined)
      .catch((error) => console.error('[Agent] workspace reconciliation sweep failed:', error));
  };

  return {
    start: () => {
      if (approvalExpiryTimer) clearInterval(approvalExpiryTimer);
      if (workspaceReconcileTimer) clearInterval(workspaceReconcileTimer);
      sweepExpiredApprovals();
      sweepWorkspaceReconciliation();
      approvalExpiryTimer = setInterval(sweepExpiredApprovals, 15_000);
      workspaceReconcileTimer = setInterval(sweepWorkspaceReconciliation, 15_000);
      approvalExpiryTimer.unref?.();
      workspaceReconcileTimer.unref?.();
    },
    stop: async () => {
      if (approvalExpiryTimer) clearInterval(approvalExpiryTimer);
      if (workspaceReconcileTimer) clearInterval(workspaceReconcileTimer);
      approvalExpiryTimer = null;
      workspaceReconcileTimer = null;
      await Promise.all([approvalExpirySweep.catch(() => undefined), workspaceReconcileSweep.catch(() => undefined)]);
    },
  };
};
