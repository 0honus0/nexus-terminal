import { isDeepStrictEqual } from 'node:util';
import type { ClockPort, JsonValue, Scope } from '../../agent.types';
import type { ToolContext, ToolInspection, ToolResult } from '../../capabilities/tool.types';
import { executionErrorCode, failedToolResult as buildFailedToolResult } from '../execution/execution-errors';
import { GovernedMutationExecutor, type GovernedMutationHooks } from '../execution/governed-mutation-executor';
import { toolLeaseTtlSeconds } from '../execution/tool-lease-policy';
import type { ToolCallRunner } from '../execution/tool-call-runner';
import type { RunExecutionReaderPort, RunSnapshotReaderPort } from '../runs/run.repository.port';
import type { CollaborationCommitPort, StateCommitResult } from '../runs/state-commit.port';
import type { RunView } from '../runs/run.types';
import type { AgentEventHub } from '../events/event-hub';
import type { SubagentCompletionCoordinator } from './subagent-completion-coordinator';
import { governedSubagentWorkspaceMutation } from './subagent-mutation-policy';
import type { SubagentContextBuilder } from './subagent-context-builder';
import type {
  DelegationCancellationPort,
  RuntimeParticipantRepositoryPort,
  RuntimeToolWorkView,
  SchedulerWorkExecutionPort,
} from './subagent.repository.port';
import type { DelegationView, SchedulerWorkView } from './subagent.types';

const errorCode = (error: unknown): string => executionErrorCode(error, 'SUBAGENT_EXECUTION_FAILED');

const terminalDelegation = (value: DelegationView): boolean =>
  value.status === 'completed' || value.status === 'failed' || value.status === 'cancelled';

const failedToolResult = (error: unknown): ToolResult =>
  buildFailedToolResult(error, {
    fallbackCode: 'SUBAGENT_EXECUTION_FAILED',
    summaryPrefix: 'Subagent tool failed',
    verificationSummary: 'The subagent tool did not return a successful result.',
  });

const interruptedMutationResult = (): ToolResult => ({
  ok: false,
  summary:
    'The Subagent mutation was interrupted after durable execution began, so Nexus will not replay it automatically.',
  data: { error: { code: 'SUBAGENT_MUTATION_OUTCOME_UNKNOWN' } },
  artifactRefs: [],
  truncated: false,
  outcome: 'unknown',
  errorCode: 'SUBAGENT_MUTATION_OUTCOME_UNKNOWN',
  verification: {
    status: 'unverified',
    summary: 'The actual Workspace state must be reconciled before another mutation is attempted.',
    evidenceRefs: [],
  },
});

const inspectionChanged = (left: ToolInspection, right: ToolInspection): boolean => !isDeepStrictEqual(left, right);

export class SubagentToolStepExecutor {
  private readonly governedMutations: GovernedMutationExecutor;

  constructor(
    private readonly work: SchedulerWorkExecutionPort,
    private readonly delegations: DelegationCancellationPort,
    private readonly runtimes: RuntimeParticipantRepositoryPort,
    private readonly runs: RunSnapshotReaderPort & Pick<RunExecutionReaderPort, 'confirmedMutation'>,
    private readonly stateCommit: CollaborationCommitPort,
    private readonly contextBuilder: SubagentContextBuilder,
    private readonly toolCalls: ToolCallRunner,
    private readonly completion: SubagentCompletionCoordinator,
    private readonly events: AgentEventHub,
    private readonly clock: ClockPort,
    private readonly recoverySafePoint: (run: RunView, reason: 'mutation_confirmed') => Promise<void> = async () =>
      undefined,
  ) {
    this.governedMutations = new GovernedMutationExecutor(runs, stateCommit, toolCalls, () =>
      this.clock.nowUnixSeconds(),
    );
  }

  async execute(scope: Scope, work: SchedulerWorkView, ownerEpoch: number, signal: AbortSignal): Promise<void> {
    const payload = work.payload;
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      typeof payload.delegationId !== 'string' ||
      typeof payload.toolStepId !== 'string' ||
      typeof payload.toolCallId !== 'string'
    ) {
      await this.work.settleWork(work.id, ownerEpoch, 'cancelled', this.clock.nowUnixSeconds());
      return;
    }
    const [delegation, run, toolWork] = await Promise.all([
      this.delegations.delegation(scope, work.runId, payload.delegationId),
      this.runs.snapshot(scope, work.runId),
      this.runtimes.runtimeToolWork(scope, work.runId, work.agentRuntimeId, payload.toolStepId, payload.toolCallId),
    ]);
    if (!delegation || !run || !toolWork || terminalDelegation(delegation) || run.status !== 'running') {
      await this.work.settleWork(work.id, ownerEpoch, 'cancelled', this.clock.nowUnixSeconds());
      return;
    }
    if (delegation.deadlineAt <= this.clock.nowUnixSeconds() || work.deadlineAt <= this.clock.nowUnixSeconds()) {
      const settled = await this.stateCommit.settleSubagentWithoutModel({
        scope,
        runId: work.runId,
        runtimeId: work.agentRuntimeId,
        delegationId: delegation.id,
        workId: work.id,
        ownerEpoch,
        outcome: 'failed',
        result: { errorCode: 'DELEGATION_DEADLINE_EXCEEDED' },
        errorCode: 'DELEGATION_DEADLINE_EXCEEDED',
        now: this.clock.nowUnixSeconds(),
      });
      this.events.publishRunWake(work.runId, settled.eventCursor);
      await this.completion.completeToolDeadline(scope, work, delegation, 'DELEGATION_DEADLINE_EXCEEDED');
      return;
    }

    if (!this.contextBuilder.allowsInspection(scope, delegation, toolWork.inspection)) {
      await this.completion.failBeforeModel(scope, work, delegation, ownerEpoch, 'SUBAGENT_TOOL_NOT_ALLOWED');
      return;
    }

    if (toolWork.inspection.mutation) {
      await this.executeChildMutation(scope, work, ownerEpoch, signal, delegation, run, toolWork);
      return;
    }

    let activeRun: RunView = run;
    if (toolWork.status === 'proposed') {
      const begun = await this.stateCommit.beginSubagentTool({
        scope,
        runId: work.runId,
        runtimeId: work.agentRuntimeId,
        delegationId: delegation.id,
        workId: work.id,
        ownerEpoch,
        toolStepId: toolWork.toolStepId,
        toolCallId: toolWork.toolCallId,
        now: this.clock.nowUnixSeconds(),
      });
      activeRun = begun.run;
      this.events.publishRunWake(work.runId, begun.eventCursor);
    } else if (toolWork.status !== 'running') {
      await this.work.settleWork(work.id, ownerEpoch, 'cancelled', this.clock.nowUnixSeconds());
      return;
    }

    let toolResult: ToolResult;
    if (toolWork.status === 'running') {
      toolResult = failedToolResult(new Error('SUBAGENT_TOOL_INTERRUPTED'));
    } else {
      const context = this.toolContext(
        activeRun,
        work.agentRuntimeId,
        toolWork.toolStepId,
        signal,
        Math.min(delegation.deadlineAt, work.deadlineAt),
      );
      const leaseTtlSeconds = toolLeaseTtlSeconds(activeRun.budget.toolTimeoutSeconds);
      let lease: Awaited<ReturnType<ToolCallRunner['acquireRead']>> | null = null;
      try {
        lease = await this.toolCalls.acquireRead(context, toolWork.inspection, leaseTtlSeconds);
        toolResult = await this.toolCalls.executeRead(lease, context, toolWork.inspection);
      } catch (error) {
        toolResult = this.toolCalls.failedRead(error);
      } finally {
        if (lease) await this.toolCalls.releaseRead(lease);
      }
    }

    let continuation: 'runnable' | 'joining' | 'waiting_message' | 'waiting_budget' = 'runnable';
    let budgetReason: JsonValue | undefined;
    if (
      toolWork.inspection.toolName === 'send_agent_message' &&
      (toolResult.errorCode === 'MAILBOX_BUDGET_EXCEEDED' || toolResult.errorCode === 'MAILBOX_HARD_LIMIT_EXCEEDED')
    ) {
      continuation = 'waiting_budget';
      budgetReason = {
        scope: 'mailbox',
        runtimeId: work.agentRuntimeId,
        delegationId: delegation.id,
        canIncrease: toolResult.errorCode === 'MAILBOX_BUDGET_EXCEEDED',
        errorCode: toolResult.errorCode,
        messages: activeRun.usage.subagentMessages,
        bytes: activeRun.usage.subagentMessageBytes,
        maxMessages: activeRun.budget.maxSubagentMessages,
        maxBytes: activeRun.budget.maxSubagentMessageBytes,
      };
    } else if (
      toolWork.inspection.toolName === 'join_subagents' &&
      toolResult.ok &&
      toolResult.data &&
      typeof toolResult.data === 'object' &&
      !Array.isArray(toolResult.data) &&
      toolResult.data.ready === false
    ) {
      continuation = 'joining';
    }
    const settled = await this.stateCommit.settleSubagentTool({
      scope,
      runId: work.runId,
      runtimeId: work.agentRuntimeId,
      delegationId: delegation.id,
      workId: work.id,
      ownerEpoch,
      toolStepId: toolWork.toolStepId,
      toolCallId: toolWork.toolCallId,
      result: toolResult,
      continuation,
      ...(budgetReason ? { budgetReason } : {}),
      now: this.clock.nowUnixSeconds(),
    });
    this.events.publishRunWake(work.runId, settled.eventCursor);
    if (continuation === 'runnable' && settled.run.status === 'running') {
      const guarded = await this.stateCommit.evaluateToolLoopGuard({
        scope,
        runId: work.runId,
        runtimeId: work.agentRuntimeId,
        delegationId: delegation.id,
        expectedRunVersion: settled.run.version,
        observations: [
          {
            toolName: toolWork.inspection.toolName,
            risk: toolWork.inspection.risk,
            operationHash: toolWork.inspection.operationHash,
            result: toolResult,
          },
        ],
        now: this.clock.nowUnixSeconds(),
      });
      if (guarded.run.version !== settled.run.version) this.events.publishRunWake(work.runId, guarded.eventCursor);
    }
  }

  private async executeChildMutation(
    scope: Scope,
    work: SchedulerWorkView,
    ownerEpoch: number,
    signal: AbortSignal,
    delegation: DelegationView,
    run: RunView,
    toolWork: RuntimeToolWorkView,
  ): Promise<void> {
    if (
      delegation.mutationMode !== 'governed' ||
      run.definition.approvalMode !== 'full_access' ||
      !toolWork.inspection.mutation ||
      !['mutate', 'destructive'].includes(toolWork.inspection.risk)
    ) {
      await this.completion.failBeforeModel(scope, work, delegation, ownerEpoch, 'SUBAGENT_MUTATION_NOT_GOVERNED');
      return;
    }
    if (toolWork.status === 'running') {
      const unknown = interruptedMutationResult();
      const settled = await this.stateCommit.settleSubagentTool({
        scope,
        runId: work.runId,
        runtimeId: work.agentRuntimeId,
        delegationId: delegation.id,
        workId: work.id,
        ownerEpoch,
        toolStepId: toolWork.toolStepId,
        toolCallId: toolWork.toolCallId,
        result: unknown,
        needsReconciliation: true,
        continuation: 'runnable',
        now: this.clock.nowUnixSeconds(),
      });
      this.events.publishRunWake(work.runId, settled.eventCursor);
      return;
    }
    if (toolWork.status !== 'proposed' && toolWork.status !== 'ready') {
      await this.work.settleWork(work.id, ownerEpoch, 'cancelled', this.clock.nowUnixSeconds());
      return;
    }

    let activeRun = run;
    let approvedWork = toolWork;
    let approvalId = toolWork.approvalId;
    if (toolWork.status === 'proposed') {
      const prepared = await this.governedMutations.prepare({
        scope,
        runId: work.runId,
        runtimeId: work.agentRuntimeId,
        toolStepId: toolWork.toolStepId,
        toolCallId: toolWork.toolCallId,
        run,
        inspection: toolWork.inspection,
        signal,
        autoApprove: true,
        hooks: this.subagentMutationHooks(scope, work, ownerEpoch, delegation, toolWork),
      });
      if (prepared.status !== 'ready') return;
      activeRun = prepared.run;
      approvalId = prepared.approvalId;
      approvedWork = {
        ...toolWork,
        status: 'ready',
        approvalId,
        inspection: prepared.inspection,
      };
    }
    if (!approvalId) {
      await this.work.settleWork(work.id, ownerEpoch, 'cancelled', this.clock.nowUnixSeconds());
      return;
    }

    await this.governedMutations.execute({
      scope,
      runId: work.runId,
      runtimeId: work.agentRuntimeId,
      toolStepId: approvedWork.toolStepId,
      toolCallId: approvedWork.toolCallId,
      run: activeRun,
      inspection: approvedWork.inspection,
      approvalId,
      signal,
      hooks: this.subagentMutationHooks(scope, work, ownerEpoch, delegation, approvedWork),
    });
  }

  private subagentMutationHooks(
    scope: Scope,
    work: SchedulerWorkView,
    ownerEpoch: number,
    delegation: DelegationView,
    toolWork: RuntimeToolWorkView,
  ): GovernedMutationHooks {
    return {
      context: (run, signal, toolCallId) =>
        this.toolContext(
          run,
          work.agentRuntimeId,
          toolWork.toolStepId,
          signal,
          Math.min(delegation.deadlineAt, work.deadlineAt),
          toolCallId,
        ),
      validateInspection: (inspection, decision) => {
        const workspaceMutation = governedSubagentWorkspaceMutation(inspection, work.runId, work.agentRuntimeId);
        if (decision.action === 'requireApproval' && workspaceMutation) return null;
        return new Error(
          decision.action === 'deny'
            ? decision.reason
            : workspaceMutation
              ? 'TOOL_POLICY_INVALID'
              : 'SUBAGENT_MUTATION_TARGET_FORBIDDEN',
        );
      },
      failedResult: (error) => failedToolResult(error),
      duplicateResult: () => failedToolResult(new Error('MUTATION_ALREADY_CONFIRMED')),
      rejectProposed: (_run, inspection, result) =>
        this.settleChildMutationWithoutExecution(
          scope,
          work,
          ownerEpoch,
          delegation,
          { ...toolWork, inspection },
          result,
        ),
      rejectReady: (_run, failure) => {
        const changed = inspectionChanged(failure.previousInspection, failure.inspection);
        const error = failure.phase === 'approval_refresh' && changed ? new Error('APPROVAL_STALE') : failure.error;
        return this.settleChildMutationWithoutExecution(
          scope,
          work,
          ownerEpoch,
          delegation,
          toolWork,
          failedToolResult(error),
        );
      },
      begin: (_run, approvalId, inspection) =>
        this.stateCommit.beginSubagentMutationTool({
          scope,
          runId: work.runId,
          runtimeId: work.agentRuntimeId,
          delegationId: delegation.id,
          workId: work.id,
          ownerEpoch,
          toolStepId: toolWork.toolStepId,
          toolCallId: toolWork.toolCallId,
          approvalId,
          operationHash: inspection.operationHash,
          expectedPolicyRevision: inspection.policyRevision,
          expectedInputRevision: inspection.inputRevision,
          now: this.clock.nowUnixSeconds(),
        }),
      settle: (_run, result) =>
        this.stateCommit.settleSubagentTool({
          scope,
          runId: work.runId,
          runtimeId: work.agentRuntimeId,
          delegationId: delegation.id,
          workId: work.id,
          ownerEpoch,
          toolStepId: toolWork.toolStepId,
          toolCallId: toolWork.toolCallId,
          result,
          ...(result.outcome === 'unknown' ? { needsReconciliation: true } : {}),
          continuation: 'runnable',
          now: this.clock.nowUnixSeconds(),
        }),
      onCommit: (commit) => {
        this.events.publishRunWake(work.runId, commit.eventCursor);
      },
      recoverySafePoint: (current) => this.recoverySafePoint(current, 'mutation_confirmed'),
      delegationId: delegation.id,
      leaseReconciliationExtra: { runtimeId: work.agentRuntimeId },
      unknownQuarantineReason: 'SUBAGENT_MUTATION_OUTCOME_UNKNOWN',
      commitFailureQuarantineReason: 'STATE_COMMIT_FAILED_AFTER_SUBAGENT_MUTATION',
      quarantineEvidence: (result, error) => ({
        toolCallId: toolWork.toolCallId,
        runtimeId: work.agentRuntimeId,
        errorCode: error ? errorCode(error) : (result?.errorCode ?? 'UNKNOWN'),
      }),
    };
  }

  private async settleChildMutationWithoutExecution(
    scope: Scope,
    work: SchedulerWorkView,
    ownerEpoch: number,
    delegation: DelegationView,
    toolWork: RuntimeToolWorkView,
    result: ToolResult,
  ): Promise<StateCommitResult> {
    if (toolWork.status === 'ready') {
      if (!toolWork.approvalId) throw new Error('APPROVAL_STATE_INVALID');
      const begun = await this.stateCommit.beginSubagentMutationTool({
        scope,
        runId: work.runId,
        runtimeId: work.agentRuntimeId,
        delegationId: delegation.id,
        workId: work.id,
        ownerEpoch,
        toolStepId: toolWork.toolStepId,
        toolCallId: toolWork.toolCallId,
        approvalId: toolWork.approvalId,
        operationHash: toolWork.inspection.operationHash,
        expectedPolicyRevision: toolWork.inspection.policyRevision,
        expectedInputRevision: toolWork.inspection.inputRevision,
        now: this.clock.nowUnixSeconds(),
      });
      this.events.publishRunWake(work.runId, begun.eventCursor);
    } else if (toolWork.status === 'proposed') {
      const begun = await this.stateCommit.beginSubagentTool({
        scope,
        runId: work.runId,
        runtimeId: work.agentRuntimeId,
        delegationId: delegation.id,
        workId: work.id,
        ownerEpoch,
        toolStepId: toolWork.toolStepId,
        toolCallId: toolWork.toolCallId,
        now: this.clock.nowUnixSeconds(),
      });
      this.events.publishRunWake(work.runId, begun.eventCursor);
    } else {
      throw new Error('TOOL_STATE_CONFLICT');
    }

    const settled = await this.stateCommit.settleSubagentTool({
      scope,
      runId: work.runId,
      runtimeId: work.agentRuntimeId,
      delegationId: delegation.id,
      workId: work.id,
      ownerEpoch,
      toolStepId: toolWork.toolStepId,
      toolCallId: toolWork.toolCallId,
      result,
      continuation: 'runnable',
      now: this.clock.nowUnixSeconds(),
    });
    this.events.publishRunWake(work.runId, settled.eventCursor);
    return settled;
  }

  private toolContext(
    run: RunView,
    runtimeId: string,
    stepId: string,
    signal: AbortSignal,
    delegationDeadlineAt: number,
    toolCallId?: string,
  ): ToolContext {
    return {
      userId: run.userId,
      appId: run.appId,
      actor: {
        kind: 'agent',
        userId: run.userId,
        appId: run.appId,
        runId: run.id,
        agentRuntimeId: runtimeId,
      },
      runId: run.id,
      agentRuntimeId: runtimeId,
      ...(toolCallId === undefined ? {} : { toolCallId }),
      connectionIds: [...run.definition.connectionIds],
      environment: run.definition.environment ?? null,
      stepId,
      signal,
      deadlineAt: Math.min(delegationDeadlineAt, this.clock.nowUnixSeconds() + run.budget.toolTimeoutSeconds),
      maxOutputBytes: run.budget.maxToolOutputBytes,
      inputRevision: run.inputRevision,
    };
  }
}
