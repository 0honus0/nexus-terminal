import { logErrorCode, logger } from '../../../../shared/logging/logger';
import type { ClockPort, Scope } from '../../agent.types';
import type { AgentEventHub } from '../events/event-hub';
import { boundedUtf8 } from '../execution/text-budget';
import type { CollaborationCommitPort } from '../runs/state-commit.port';
import type { MailboxService } from './mailbox.service';
import type { SubagentExecutionHost } from './subagent-execution-host.port';
import type {
  DelegationCancellationPort,
  RuntimeParticipantRepositoryPort,
  SchedulerWorkExecutionPort,
} from './subagent.repository.port';
import type { DelegationView, SchedulerWorkView } from './subagent.types';

const MAX_COMPLETION_BYTES = 8 * 1024;
const MAX_WORKER_EVIDENCE_REFS = 64;
const MAX_WORKER_EVIDENCE_TOOLS = 16;

const terminalDelegation = (value: DelegationView): boolean =>
  value.status === 'completed' || value.status === 'failed' || value.status === 'cancelled';

const errorCode = (error: unknown): string => logErrorCode(error, 'SUBAGENT_EXECUTION_FAILED');

export interface VerifiedRuntimeEvidence {
  artifactRefs: string[];
  tools: Array<{ toolName: string; summary: string; verificationSummary: string; evidenceRefs: string[] }>;
}

export class SubagentCompletionCoordinator {
  constructor(
    private readonly work: SchedulerWorkExecutionPort,
    private readonly delegations: DelegationCancellationPort,
    private readonly runtimes: RuntimeParticipantRepositoryPort,
    private readonly stateCommit: CollaborationCommitPort,
    private readonly mailbox: MailboxService,
    private readonly events: AgentEventHub,
    private readonly host: SubagentExecutionHost,
    private readonly clock: ClockPort,
  ) {}

  async handleTerminalCandidate(scope: Scope, claimed: SchedulerWorkView, ownerEpoch: number): Promise<void> {
    const payload = claimed.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.delegationId !== 'string') {
      await this.work.settleWork(claimed.id, ownerEpoch, 'cancelled', this.clock.nowUnixSeconds());
      return;
    }
    const delegation = await this.delegations.delegation(scope, claimed.runId, payload.delegationId);
    if (!delegation || terminalDelegation(delegation)) {
      await this.work.settleWork(claimed.id, ownerEpoch, 'cancelled', this.clock.nowUnixSeconds());
      return;
    }
    const code =
      claimed.deadlineAt <= this.clock.nowUnixSeconds() ? 'DELEGATION_DEADLINE_EXCEEDED' : 'DEPENDENCY_FAILED';
    const settled = await this.stateCommit.settleSubagentWithoutModel({
      scope,
      runId: claimed.runId,
      runtimeId: claimed.agentRuntimeId,
      delegationId: delegation.id,
      workId: claimed.id,
      ownerEpoch,
      outcome: 'failed',
      result: { errorCode: code },
      errorCode: code,
      now: this.clock.nowUnixSeconds(),
    });
    this.events.publishRunWake(claimed.runId, settled.eventCursor);
    await this.sendCompletion(scope, claimed.runId, delegation, 'failed', '', code).catch((error) =>
      logger.warn(
        {
          errorCode: logErrorCode(error, 'SUBAGENT_COMPLETION_MAILBOX_FAILED'),
          userId: scope.userId,
          appId: scope.appId,
          runId: claimed.runId,
          runtimeId: claimed.agentRuntimeId,
          workId: claimed.id,
          delegationId: delegation.id,
          outcome: 'failed',
        },
        'Agent Subagent terminal completion notification failed',
      ),
    );
    if (delegation.failureMode === 'failFast') await this.cancelSiblings(scope, delegation);
    await this.resumeParent(scope, claimed.runId, delegation);
  }

  async failBeforeModel(
    scope: Scope,
    work: SchedulerWorkView,
    delegation: DelegationView,
    ownerEpoch: number,
    code: string,
  ): Promise<void> {
    const settled = await this.stateCommit.settleSubagentWithoutModel({
      scope,
      runId: work.runId,
      runtimeId: work.agentRuntimeId,
      delegationId: delegation.id,
      workId: work.id,
      ownerEpoch,
      outcome: 'failed',
      result: { errorCode: code },
      errorCode: code,
      now: this.clock.nowUnixSeconds(),
    });
    this.events.publishRunWake(work.runId, settled.eventCursor);
    await this.sendCompletion(scope, work.runId, delegation, 'failed', '', code).catch((error) =>
      logger.warn(
        {
          errorCode: logErrorCode(error, 'SUBAGENT_COMPLETION_MAILBOX_FAILED'),
          userId: scope.userId,
          appId: scope.appId,
          runId: work.runId,
          runtimeId: work.agentRuntimeId,
          workId: work.id,
          delegationId: delegation.id,
          failureCode: code,
        },
        'Agent Subagent pre-model failure notification failed',
      ),
    );
    if (delegation.failureMode === 'failFast') await this.cancelSiblings(scope, delegation);
    await this.resumeParent(scope, work.runId, delegation);
  }

  async verifiedRuntimeEvidenceRefs(scope: Scope, runId: string, runtimeId: string): Promise<string[]> {
    return (await this.verifiedRuntimeEvidence(scope, runId, runtimeId)).artifactRefs;
  }

  async verifiedRuntimeEvidence(scope: Scope, runId: string, runtimeId: string): Promise<VerifiedRuntimeEvidence> {
    const exchanges = await this.runtimes.recentRuntimeToolExchanges(scope, runId, runtimeId, 32);
    const refs = new Set<string>();
    const tools: VerifiedRuntimeEvidence['tools'] = [];
    for (const exchange of exchanges) {
      const result = exchange.result;
      if (!result || result.outcome !== 'confirmed' || result.verification.status !== 'verified') continue;
      const resultRefs = [...new Set([...result.artifactRefs, ...result.verification.evidenceRefs])].filter(
        (ref): ref is string => typeof ref === 'string' && ref.length > 0,
      );
      if (tools.length < MAX_WORKER_EVIDENCE_TOOLS) {
        tools.push({
          toolName: exchange.toolName,
          summary: boundedUtf8(result.summary, 1_024),
          verificationSummary: boundedUtf8(result.verification.summary, 1_024),
          evidenceRefs: resultRefs.slice(0, 16),
        });
      }
      for (const ref of resultRefs) {
        refs.add(ref);
        if (refs.size >= MAX_WORKER_EVIDENCE_REFS) return { artifactRefs: [...refs], tools };
      }
    }
    return { artifactRefs: [...refs], tools };
  }

  async completeToolDeadline(
    scope: Scope,
    work: SchedulerWorkView,
    delegation: DelegationView,
    code: string,
  ): Promise<void> {
    await this.sendCompletion(scope, work.runId, delegation, 'failed', '', code).catch(() => undefined);
    await this.resumeParent(scope, work.runId, delegation);
  }

  async completeModelEarlyFailure(
    scope: Scope,
    work: SchedulerWorkView,
    delegation: DelegationView,
    code: string,
  ): Promise<void> {
    await this.sendCompletion(scope, work.runId, delegation, 'failed', '', code).catch(() => undefined);
    if (delegation.failureMode === 'failFast') await this.cancelSiblings(scope, delegation);
    await this.resumeParent(scope, work.runId, delegation);
  }

  async completeModelResult(
    scope: Scope,
    work: SchedulerWorkView,
    delegation: DelegationView,
    outcome: 'completed' | 'failed' | 'cancelled',
    summary: string,
    failureCode: string | undefined,
    evidenceRefs: readonly string[],
  ): Promise<void> {
    await this.sendCompletion(scope, work.runId, delegation, outcome, summary, failureCode, evidenceRefs).catch(
      (error) => {
        logger.warn(
          {
            userId: scope.userId,
            appId: scope.appId,
            runId: work.runId,
            runtimeId: work.agentRuntimeId,
            workId: work.id,
            delegationId: delegation.id,
            outcome,
            errorCode: logErrorCode(error, 'SUBAGENT_COMPLETION_MAILBOX_FAILED'),
          },
          'Agent Subagent completion mailbox projection failed',
        );
      },
    );
    if (outcome === 'failed' && delegation.failureMode === 'failFast') await this.cancelSiblings(scope, delegation);
    await this.resumeParent(scope, work.runId, delegation);
  }

  private async sendCompletion(
    scope: Scope,
    runId: string,
    delegation: DelegationView,
    outcome: 'completed' | 'failed' | 'cancelled',
    summary: string,
    failureCode?: string,
    evidenceRefs: readonly string[] = delegation.evidenceRefs,
  ): Promise<void> {
    await this.mailbox.send(
      scope,
      runId,
      delegation.childRuntimeId,
      {
        recipientRuntimeId: delegation.parentRuntimeId,
        delegationId: delegation.id,
        kind: 'completion',
        correlationId: delegation.id,
        replyTo: null,
        causationId: null,
        taskRevision: delegation.version,
        body: {
          status: outcome,
          summary: boundedUtf8(summary, MAX_COMPLETION_BYTES),
          errorCode: failureCode ?? null,
        },
        artifactRefs: [...evidenceRefs],
        ttlSeconds: 86_400,
      },
      delegation.id,
    );
  }

  private async cancelSiblings(scope: Scope, failed: DelegationView): Promise<void> {
    const siblings = await this.delegations.listDelegations(scope, failed.runId, failed.parentRuntimeId);
    for (const sibling of siblings) {
      if (sibling.id === failed.id || terminalDelegation(sibling)) continue;
      const descendants = await this.delegations.descendants(scope, failed.runId, sibling.childRuntimeId);
      for (const descendant of descendants) {
        if (terminalDelegation(descendant)) continue;
        const cancelled = await this.delegations
          .cancelDelegation(scope, failed.runId, descendant.id, descendant.version, this.clock.nowUnixSeconds())
          .catch((error) => {
            logger.warn(
              {
                errorCode: errorCode(error),
                runId: failed.runId,
                failedDelegationId: failed.id,
                delegationId: descendant.id,
                runtimeId: descendant.childRuntimeId,
              },
              'Agent Subagent descendant cancellation failed',
            );
            return null;
          });
        if (cancelled) this.host.cancelChildRuntime(failed.runId, cancelled.childRuntimeId);
      }
      const cancelled = await this.delegations
        .cancelDelegation(scope, failed.runId, sibling.id, sibling.version, this.clock.nowUnixSeconds())
        .catch((error) => {
          logger.warn(
            {
              errorCode: errorCode(error),
              runId: failed.runId,
              failedDelegationId: failed.id,
              delegationId: sibling.id,
              runtimeId: sibling.childRuntimeId,
            },
            'Agent Subagent sibling cancellation failed',
          );
          return null;
        });
      if (cancelled) this.host.cancelChildRuntime(failed.runId, cancelled.childRuntimeId);
    }
  }

  private async resumeParent(scope: Scope, runId: string, completed: DelegationView): Promise<void> {
    const all = await this.delegations.listDelegations(scope, runId);
    const parentDelegation = all.find((delegation) => delegation.childRuntimeId === completed.parentRuntimeId) ?? null;
    if (parentDelegation) {
      this.host.wakeChildScheduler();
      return;
    }
    const siblings = all.filter((delegation) => delegation.parentRuntimeId === completed.parentRuntimeId);
    if (siblings.some((delegation) => !terminalDelegation(delegation))) return;
    await this.host.enqueueRootRun(runId, scope);
  }
}
