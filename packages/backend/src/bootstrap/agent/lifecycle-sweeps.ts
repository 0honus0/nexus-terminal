import { logger } from '../../shared/logging/logger';
import type { ClockPort } from '../../modules/agent/agent.types';
import type { ArtifactMaintenancePort } from '../../modules/agent/ai/artifact.port';
import type { ApprovalSweepCommitPort } from '../../modules/agent/runtime/runs/state-commit.port';
import type { AgentScheduler } from '../../modules/agent/runtime/scheduling/scheduler';
import type { WorkspaceRuntimeService } from '../../modules/agent/workspace-runtime/workspace-runtime.service';

type SchedulerRun = Parameters<AgentScheduler['enqueue']>[0];

export interface AgentLifecycleSweeps {
  start(): void;
  stop(): Promise<void>;
}

export interface CreateAgentLifecycleSweepsOptions {
  stateCommit: ApprovalSweepCommitPort;
  workspaceRuntime: WorkspaceRuntimeService;
  artifactMaintenance: ArtifactMaintenancePort;
  scheduler: AgentScheduler;
  clock: ClockPort;
  notifyCommitted(run: SchedulerRun): void;
}

export const createAgentLifecycleSweeps = ({
  stateCommit,
  workspaceRuntime,
  artifactMaintenance,
  scheduler,
  clock,
  notifyCommitted,
}: CreateAgentLifecycleSweepsOptions): AgentLifecycleSweeps => {
  let approvalExpiryTimer: NodeJS.Timeout | null = null;
  let approvalExpirySweep = Promise.resolve();
  let workspaceReconcileTimer: NodeJS.Timeout | null = null;
  let workspaceReconcileSweep = Promise.resolve();
  let artifactReconcileTimer: NodeJS.Timeout | null = null;
  let artifactReconcileSweep = Promise.resolve();

  const sweepExpiredApprovals = (): void => {
    approvalExpirySweep = approvalExpirySweep
      .then(async () => {
        const now = clock.nowUnixSeconds();
        const resumed = await stateCommit.expireToolApprovals(now);
        for (const run of resumed) {
          notifyCommitted(run);
          scheduler.enqueue(run);
        }
        if (resumed.length > 0)
          logger.debug({ resumedRuns: resumed.length }, 'Agent approval expiry sweep resumed Runs');
        const cleanedCommands = await stateCommit.cleanupExpiredCommands(now, 200);
        if (cleanedCommands > 0)
          logger.debug({ cleanedCommands }, 'Agent idempotency TTL sweep removed expired committed commands');
      })
      .catch((error) => logger.warn({ err: error }, 'Agent approval expiry sweep failed'));
  };

  const sweepWorkspaceReconciliation = (): void => {
    workspaceReconcileSweep = workspaceReconcileSweep
      .then(() => workspaceRuntime.reconcile())
      .then((completed) => {
        if (completed > 0)
          logger.debug({ completedCommands: completed }, 'Agent Workspace reconciliation sweep completed commands');
      })
      .catch((error) => logger.warn({ err: error }, 'Agent Workspace reconciliation sweep failed'));
  };

  const sweepArtifactReconciliation = (): void => {
    artifactReconcileSweep = artifactReconcileSweep
      .then(() => artifactMaintenance.reconcile())
      .then((repaired) => {
        if (repaired > 0) logger.debug({ repairedArtifacts: repaired }, 'Agent Artifact reconciliation sweep repaired rows');
      })
      .catch((error) => logger.warn({ err: error }, 'Agent Artifact reconciliation sweep failed'));
  };

  return {
    start: () => {
      logger.debug('Agent lifecycle sweeps starting');
      if (approvalExpiryTimer) clearInterval(approvalExpiryTimer);
      if (workspaceReconcileTimer) clearInterval(workspaceReconcileTimer);
      if (artifactReconcileTimer) clearInterval(artifactReconcileTimer);
      sweepExpiredApprovals();
      sweepWorkspaceReconciliation();
      sweepArtifactReconciliation();
      approvalExpiryTimer = setInterval(sweepExpiredApprovals, 15_000);
      workspaceReconcileTimer = setInterval(sweepWorkspaceReconciliation, 15_000);
      artifactReconcileTimer = setInterval(sweepArtifactReconciliation, 15_000);
      approvalExpiryTimer.unref?.();
      workspaceReconcileTimer.unref?.();
      artifactReconcileTimer.unref?.();
    },
    stop: async () => {
      logger.debug('Agent lifecycle sweeps stopping');
      if (approvalExpiryTimer) clearInterval(approvalExpiryTimer);
      if (workspaceReconcileTimer) clearInterval(workspaceReconcileTimer);
      if (artifactReconcileTimer) clearInterval(artifactReconcileTimer);
      approvalExpiryTimer = null;
      workspaceReconcileTimer = null;
      artifactReconcileTimer = null;
      await Promise.all([
        approvalExpirySweep.catch(() => undefined),
        workspaceReconcileSweep.catch(() => undefined),
        artifactReconcileSweep.catch(() => undefined),
      ]);
    },
  };
};
