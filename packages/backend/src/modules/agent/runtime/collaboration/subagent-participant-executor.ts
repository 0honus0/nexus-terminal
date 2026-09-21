import { randomUUID } from 'node:crypto';
import type { ClockPort, Scope } from '../../agent.types';
import type { SubagentCompletionCoordinator } from './subagent-completion-coordinator';
import type { SubagentExecutionHost } from './subagent-execution-host.port';
import type { SubagentModelStepExecutor } from './subagent-model-step-executor';
import type { DelegationCancellationPort, SchedulerWorkExecutionPort } from './subagent.repository.port';
import type { DelegationView, SchedulerWorkView } from './subagent.types';
import type { SubagentToolStepExecutor } from './subagent-tool-step-executor';

const terminalDelegation = (value: DelegationView): boolean =>
  value.status === 'completed' || value.status === 'failed' || value.status === 'cancelled';

/**
 * Scheduler-facing Subagent participant facade.
 *
 * Durable execution authority remains in StateCommit. Model work, Tool work,
 * and completion/lifecycle projection are delegated to dedicated collaborators.
 */
export class SubagentParticipantExecutor {
  constructor(
    private readonly work: SchedulerWorkExecutionPort,
    private readonly delegations: DelegationCancellationPort,
    private readonly completion: SubagentCompletionCoordinator,
    private readonly tools: SubagentToolStepExecutor,
    private readonly models: SubagentModelStepExecutor,
    private readonly host: SubagentExecutionHost,
    private readonly clock: ClockPort,
  ) {}

  async handleTerminalCandidate(scope: Scope, claimed: SchedulerWorkView, ownerEpoch: number): Promise<void> {
    await this.completion.handleTerminalCandidate(scope, claimed, ownerEpoch);
  }

  async handleInboxWake(scope: Scope, work: SchedulerWorkView, ownerEpoch: number): Promise<void> {
    await this.work.settleWork(work.id, ownerEpoch, 'completed', this.clock.nowUnixSeconds());
    const delegations = await this.delegations.listDelegations(scope, work.runId);
    const child = delegations.find((delegation) => delegation.childRuntimeId === work.agentRuntimeId);
    if (child && !terminalDelegation(child)) {
      await this.work.enqueueWork({
        id: `work-${randomUUID()}`,
        runId: work.runId,
        runtimeId: work.agentRuntimeId,
        kind: 'model_step',
        payload: { delegationId: child.id, cause: 'mailbox' },
        notBefore: this.clock.nowUnixSeconds(),
        deadlineAt: child.deadlineAt,
        now: this.clock.nowUnixSeconds(),
      });
      return;
    }
    if (!child) await this.host.enqueueRootRun(work.runId, scope);
  }

  async handleJoinResume(scope: Scope, work: SchedulerWorkView, ownerEpoch: number): Promise<void> {
    const payload = work.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      await this.work.settleWork(work.id, ownerEpoch, 'cancelled', this.clock.nowUnixSeconds());
      return;
    }
    const delegationIds = Array.isArray(payload.delegationIds)
      ? payload.delegationIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : [];
    const mode = payload.mode === 'any' ? 'any' : payload.mode === 'all' ? 'all' : null;
    const joinDeadlineAt = payload.joinDeadlineAt;
    const parentDelegationId =
      payload.parentDelegationId === null || typeof payload.parentDelegationId === 'string'
        ? payload.parentDelegationId
        : undefined;
    if (
      delegationIds.length < 1 ||
      !mode ||
      !Number.isSafeInteger(joinDeadlineAt) ||
      parentDelegationId === undefined
    ) {
      await this.work.settleWork(work.id, ownerEpoch, 'cancelled', this.clock.nowUnixSeconds());
      return;
    }
    const values = await Promise.all(
      delegationIds.map((delegationId) => this.delegations.delegation(scope, work.runId, delegationId)),
    );
    if (values.some((delegation) => delegation === null || delegation.parentRuntimeId !== work.agentRuntimeId)) {
      await this.work.settleWork(work.id, ownerEpoch, 'cancelled', this.clock.nowUnixSeconds());
      return;
    }
    const delegations = values as DelegationView[];
    const settledCount = delegations.filter((delegation) => terminalDelegation(delegation)).length;
    const runningCount = delegations.length - settledCount;
    const timedOut = runningCount > 0 && this.clock.nowUnixSeconds() >= (joinDeadlineAt as number);
    const ready = timedOut || (mode === 'all' ? runningCount === 0 : settledCount > 0);
    const resumed = await this.work.completeJoinResume(
      work.id,
      ownerEpoch,
      work.runId,
      work.agentRuntimeId,
      parentDelegationId,
      ready,
      this.clock.nowUnixSeconds(),
    );
    if (resumed && parentDelegationId === null) await this.host.enqueueRootRun(work.runId, scope);
  }

  async execute(scope: Scope, work: SchedulerWorkView, ownerEpoch: number, signal: AbortSignal): Promise<void> {
    if (work.kind === 'tool_step') {
      await this.tools.execute(scope, work, ownerEpoch, signal);
      return;
    }
    if (work.kind === 'model_step') {
      await this.models.execute(scope, work, ownerEpoch, signal);
      return;
    }
    await this.work.settleWork(work.id, ownerEpoch, 'cancelled', this.clock.nowUnixSeconds());
  }
}
