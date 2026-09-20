import { logger } from '../../shared/logging/logger';
import type { ClockPort } from '../../modules/agent/agent.types';
import type { ArtifactMaintenancePort } from '../../modules/agent/ai/artifact.port';
import type { MailboxService } from '../../modules/agent/runtime/collaboration/mailbox.service';
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
  mailbox: Pick<MailboxService, 'sweepExpired'>;
  scheduler: AgentScheduler;
  clock: ClockPort;
  notifyCommitted(run: SchedulerRun): void;
  retryRestartRecovery?: () => Promise<number>;
  retryMcpIntegrations?: () => Promise<number>;
}

export const createAgentLifecycleSweeps = ({
  stateCommit,
  workspaceRuntime,
  artifactMaintenance,
  mailbox,
  scheduler,
  clock,
  notifyCommitted,
  retryRestartRecovery,
  retryMcpIntegrations,
}: CreateAgentLifecycleSweepsOptions): AgentLifecycleSweeps => {
  let approvalExpiryTimer: NodeJS.Timeout | null = null;
  let approvalExpirySweep = Promise.resolve();
  let workspaceReconcileTimer: NodeJS.Timeout | null = null;
  let workspaceReconcileSweep = Promise.resolve();
  let artifactReconcileTimer: NodeJS.Timeout | null = null;
  let artifactReconcileSweep = Promise.resolve();
  let mailboxExpiryTimer: NodeJS.Timeout | null = null;
  let mailboxExpirySweep = Promise.resolve();
  let restartRecoveryTimer: NodeJS.Timeout | null = null;
  let restartRecoverySweep = Promise.resolve();
  let integrationRetryTimer: NodeJS.Timeout | null = null;
  let integrationRetrySweep = Promise.resolve();

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
      .then(async () => {
        const repaired = await artifactMaintenance.reconcile();
        const expired = await artifactMaintenance.sweepExpired();
        if (repaired > 0) {
          logger.debug({ repairedArtifacts: repaired }, 'Agent Artifact reconciliation sweep repaired rows');
        }
        if (expired > 0) {
          logger.debug({ expiredArtifacts: expired }, 'Agent Artifact retention sweep reclaimed rows');
        }
      })
      .catch((error) => logger.warn({ err: error }, 'Agent Artifact reconciliation sweep failed'));
  };

  const sweepExpiredMailbox = (): void => {
    mailboxExpirySweep = mailboxExpirySweep
      .then(async () => {
        const expired = await mailbox.sweepExpired();
        if (expired > 0) {
          logger.debug({ expiredMessages: expired }, 'Agent Subagent mailbox TTL sweep expired messages');
        }
      })
      .catch((error) => logger.warn({ err: error }, 'Agent Subagent mailbox TTL sweep failed'));
  };

  const sweepRestartRecovery = (): void => {
    if (!retryRestartRecovery) return;
    restartRecoverySweep = restartRecoverySweep
      .then(async () => {
        const recovered = await retryRestartRecovery();
        if (recovered > 0) {
          logger.info({ recoveredRuns: recovered }, 'Agent deferred backend-restart recovery continued Runs');
        }
      })
      .catch((error) => logger.warn({ err: error }, 'Agent deferred backend-restart recovery sweep failed'));
  };

  const sweepIntegrationRetry = (): void => {
    if (!retryMcpIntegrations) return;
    integrationRetrySweep = integrationRetrySweep
      .then(async () => {
        const retried = await retryMcpIntegrations();
        if (retried > 0) logger.debug({ retriedIntegrations: retried }, 'Agent MCP integration retry sweep ran');
      })
      .catch((error) => logger.warn({ err: error }, 'Agent MCP integration retry sweep failed'));
  };

  return {
    start: () => {
      logger.debug('Agent lifecycle sweeps starting');
      if (approvalExpiryTimer) clearInterval(approvalExpiryTimer);
      if (workspaceReconcileTimer) clearInterval(workspaceReconcileTimer);
      if (artifactReconcileTimer) clearInterval(artifactReconcileTimer);
      if (mailboxExpiryTimer) clearInterval(mailboxExpiryTimer);
      if (restartRecoveryTimer) clearInterval(restartRecoveryTimer);
      if (integrationRetryTimer) clearInterval(integrationRetryTimer);
      sweepExpiredApprovals();
      sweepWorkspaceReconciliation();
      sweepArtifactReconciliation();
      sweepExpiredMailbox();
      sweepRestartRecovery();
      sweepIntegrationRetry();
      approvalExpiryTimer = setInterval(sweepExpiredApprovals, 15_000);
      workspaceReconcileTimer = setInterval(sweepWorkspaceReconciliation, 15_000);
      artifactReconcileTimer = setInterval(sweepArtifactReconciliation, 15_000);
      mailboxExpiryTimer = setInterval(sweepExpiredMailbox, 15_000);
      restartRecoveryTimer = setInterval(sweepRestartRecovery, 15_000);
      integrationRetryTimer = setInterval(sweepIntegrationRetry, 15_000);
      approvalExpiryTimer.unref?.();
      workspaceReconcileTimer.unref?.();
      artifactReconcileTimer.unref?.();
      mailboxExpiryTimer.unref?.();
      restartRecoveryTimer.unref?.();
      integrationRetryTimer.unref?.();
    },
    stop: async () => {
      logger.debug('Agent lifecycle sweeps stopping');
      if (approvalExpiryTimer) clearInterval(approvalExpiryTimer);
      if (workspaceReconcileTimer) clearInterval(workspaceReconcileTimer);
      if (artifactReconcileTimer) clearInterval(artifactReconcileTimer);
      if (mailboxExpiryTimer) clearInterval(mailboxExpiryTimer);
      if (restartRecoveryTimer) clearInterval(restartRecoveryTimer);
      if (integrationRetryTimer) clearInterval(integrationRetryTimer);
      approvalExpiryTimer = null;
      workspaceReconcileTimer = null;
      artifactReconcileTimer = null;
      mailboxExpiryTimer = null;
      restartRecoveryTimer = null;
      integrationRetryTimer = null;
      await Promise.all([
        approvalExpirySweep.catch(() => undefined),
        workspaceReconcileSweep.catch(() => undefined),
        artifactReconcileSweep.catch(() => undefined),
        mailboxExpirySweep.catch(() => undefined),
        restartRecoverySweep.catch(() => undefined),
        integrationRetrySweep.catch(() => undefined),
      ]);
    },
  };
};
