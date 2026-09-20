import { createHash, randomUUID } from 'node:crypto';
import { logErrorCode, logger } from '../../../../shared/logging/logger';
import type { ClockPort, JsonValue, Scope } from '../../agent.types';
import type { LanguageModelPort } from '../../ai/language-model.port';
import { applyModelCapabilitySnapshot } from '../../ai/model-capability-resolver';
import { modelCacheLineageKey } from '../../ai/model-cache-hint';
import type { ModelFinishReason, ModelProviderContinuation, TokenUsage } from '../../ai/model.types';
import type { ProviderService } from '../../ai/provider.service';
import type { LeaseOwner, ResourceLease } from '../../capabilities/lease.port';
import type { ToolExecutor } from '../../capabilities/tool-executor';
import type { ToolContext, ToolInspection, ToolProposal, ToolResult } from '../../capabilities/tool.types';
import { requestHash } from '../runs/idempotency';
import { TOOL_APPROVAL_TTL_SECONDS } from '../approvals/approval-policy';
import type { AgentEventHub } from '../events/event-hub';
import { executionErrorCode, failedToolResult as buildFailedToolResult } from '../execution/execution-errors';
import { modelFinishDisposition } from '../execution/model-finish-policy';
import { LeaseCoordinator, type LeaseRenewal } from '../execution/lease-coordinator';
import { toolLeaseTtlSeconds } from '../execution/tool-lease-policy';
import type { ToolCallRunner } from '../execution/tool-call-runner';
import type { ModelCallLimiter } from '../execution/model-call-limiter';
import { estimateTokens } from '../execution/model-accounting';
import { boundedUtf8 } from '../execution/text-budget';
import type { RunExecutionReaderPort, RunSnapshotReaderPort } from '../runs/run.repository.port';
import type { RunView } from '../runs/run.types';
import type { CollaborationCommitPort } from '../runs/state-commit.port';
import type { MailboxService } from './mailbox.service';
import type { SubagentContextBuilder } from './subagent-context-builder';
import { governedSubagentWorkspaceMutation } from './subagent-mutation-policy';
import type {
  DelegationCancellationPort,
  MailboxConsumerPort,
  RuntimeParticipantRepositoryPort,
  SchedulerWorkExecutionPort,
} from './subagent.repository.port';
import type { DelegationView, SchedulerWorkView } from './subagent.types';

const MAX_CHILD_OUTPUT_BYTES = 64 * 1024;
const MAX_COMPLETION_BYTES = 8 * 1024;
const MAX_WORKER_EVIDENCE_REFS = 64;
const MAX_WORKER_EVIDENCE_TOOLS = 16;

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

const inspectionChanged = (left: ToolInspection, right: ToolInspection): boolean =>
  JSON.stringify(left) !== JSON.stringify(right);

const rejectedToolInspection = (
  run: RunView,
  runtimeId: string,
  proposal: ToolProposal,
  failureCode: string,
): ToolInspection => {
  const operationHash = createHash('sha256')
    .update(
      JSON.stringify({
        kind: 'rejected_subagent_tool_call',
        runId: run.id,
        runtimeId,
        providerCallId: proposal.providerCallId,
        toolName: proposal.name,
        argumentsJson: proposal.argumentsJson,
        inputRevision: run.inputRevision,
        failureCode,
      }),
      'utf8',
    )
    .digest('hex');
  return {
    toolName: proposal.name,
    toolVersion: 'unavailable',
    normalizedArguments: {},
    target: {
      kind: 'run',
      targetIdentity: `run:${run.id}:subagent:${runtimeId}:rejected-tool:${proposal.providerCallId}`,
      endpoint: `run:${run.id}`,
      loginUser: `agent-runtime:${runtimeId}`,
      configurationHash: operationHash,
    },
    resourceKeys: [],
    risk: 'forbidden',
    mutation: false,
    operationHash,
    operationHashVersion: 1,
    preconditions: [],
    policyRevision: run.definition.policyRevision,
    inputRevision: run.inputRevision,
  };
};

interface ToolCallAccumulator {
  id?: string;
  name?: string;
  argumentsJson: string;
}

export interface SubagentExecutionHost {
  enqueueRootRun(runId: string, scope: Scope): Promise<void>;
  wakeChildScheduler(): void;
  cancelChildRuntime(runId: string, runtimeId: string): void;
}

export class SubagentParticipantExecutor {
  constructor(
    private readonly work: SchedulerWorkExecutionPort,
    private readonly delegations: DelegationCancellationPort,
    private readonly runtimes: RuntimeParticipantRepositoryPort,
    private readonly mailboxes: MailboxConsumerPort,
    private readonly runs: RunSnapshotReaderPort & Pick<RunExecutionReaderPort, 'confirmedMutation'>,
    private readonly providers: ProviderService,
    private readonly modelPort: LanguageModelPort,
    private readonly modelCalls: ModelCallLimiter,
    private readonly stateCommit: CollaborationCommitPort,
    private readonly contextBuilder: SubagentContextBuilder,
    private readonly toolExecutor: ToolExecutor,
    private readonly leaseCoordinator: LeaseCoordinator,
    private readonly mailbox: MailboxService,
    private readonly events: AgentEventHub,
    private readonly host: SubagentExecutionHost,
    private readonly clock: ClockPort,
    private readonly toolCalls: ToolCallRunner | null = null,
    private readonly recoverySafePoint: (run: RunView, reason: 'mutation_confirmed') => Promise<void> = async () =>
      undefined,
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
    await this.sendCompletion(scope, claimed.runId, delegation, 'failed', '', code).catch(() => undefined);
    if (delegation.failureMode === 'failFast') await this.cancelSiblings(scope, delegation);
    await this.resumeParent(scope, claimed.runId, delegation);
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
      await this.executeChildTool(scope, work, ownerEpoch, signal);
      return;
    }
    if (work.kind === 'model_step') {
      await this.executeChild(scope, work, ownerEpoch, signal);
      return;
    }
    await this.work.settleWork(work.id, ownerEpoch, 'cancelled', this.clock.nowUnixSeconds());
  }

  private async executeChildTool(
    scope: Scope,
    work: SchedulerWorkView,
    ownerEpoch: number,
    signal: AbortSignal,
  ): Promise<void> {
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
      await this.sendCompletion(scope, work.runId, delegation, 'failed', '', 'DELEGATION_DEADLINE_EXCEEDED').catch(
        () => undefined,
      );
      await this.resumeParent(scope, work.runId, delegation);
      return;
    }

    if (!this.contextBuilder.allowsTool(scope, delegation, toolWork.inspection.toolName)) {
      await this.failBeforeModel(scope, work, delegation, ownerEpoch, 'SUBAGENT_TOOL_NOT_ALLOWED');
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
      const owner: LeaseOwner = { type: 'agent', id: work.agentRuntimeId };
      const context = this.toolContext(
        activeRun,
        work.agentRuntimeId,
        toolWork.toolStepId,
        signal,
        Math.min(delegation.deadlineAt, work.deadlineAt),
      );
      const leaseTtlSeconds = toolLeaseTtlSeconds(activeRun.budget.toolTimeoutSeconds);
      let leases: ResourceLease[] = [];
      let renewal: LeaseRenewal | null = null;
      try {
        leases = await this.leaseCoordinator.acquireWithRetry(
          owner,
          toolWork.inspection.resourceKeys,
          'read',
          leaseTtlSeconds,
          signal,
          context.deadlineAt,
        );
        renewal = this.leaseCoordinator.startRenewal(
          leases.map((lease) => lease.id),
          owner,
          leaseTtlSeconds,
          signal,
        );
        try {
          toolResult = await this.toolExecutor.execute({ ...context, signal: renewal.signal }, toolWork.inspection);
        } catch (error) {
          toolResult = failedToolResult(error);
        }
        const renewalError = await renewal.stop();
        if (renewalError) toolResult = failedToolResult(renewalError);
      } catch (error) {
        toolResult = failedToolResult(error);
      } finally {
        await renewal?.stop().catch(() => undefined);
        await this.leaseCoordinator
          .release(
            leases.map((lease) => lease.id),
            owner,
          )
          .catch(() => undefined);
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
    toolWork: Awaited<ReturnType<RuntimeParticipantRepositoryPort['runtimeToolWork']>> & {},
  ): Promise<void> {
    if (
      !toolWork ||
      !this.toolCalls ||
      delegation.mutationMode !== 'governed' ||
      run.definition.approvalMode !== 'full_access' ||
      !toolWork.inspection.mutation ||
      !['mutate', 'destructive'].includes(toolWork.inspection.risk)
    ) {
      await this.failBeforeModel(scope, work, delegation, ownerEpoch, 'SUBAGENT_MUTATION_NOT_GOVERNED');
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
    let inspection = toolWork.inspection;
    let decision;
    try {
      ({ inspection, policyDecision: decision } = await this.toolCalls.refreshMutationInspection(
        this.toolContext(
          activeRun,
          work.agentRuntimeId,
          toolWork.toolStepId,
          signal,
          Math.min(delegation.deadlineAt, work.deadlineAt),
        ),
        toolWork.inspection,
      ));
    } catch (error) {
      await this.settleChildMutationWithoutExecution(
        scope,
        work,
        ownerEpoch,
        delegation,
        activeRun,
        toolWork,
        failedToolResult(error),
      );
      return;
    }

    const workspaceMutation = governedSubagentWorkspaceMutation(inspection, work.runId, work.agentRuntimeId);
    if (decision.action !== 'requireApproval' || !workspaceMutation) {
      await this.settleChildMutationWithoutExecution(
        scope,
        work,
        ownerEpoch,
        delegation,
        activeRun,
        toolWork,
        failedToolResult(
          new Error(
            decision.action === 'deny'
              ? decision.reason
              : workspaceMutation
                ? 'TOOL_POLICY_INVALID'
                : 'SUBAGENT_MUTATION_TARGET_FORBIDDEN',
          ),
        ),
      );
      return;
    }

    if (toolWork.status === 'ready' && inspectionChanged(toolWork.inspection, inspection)) {
      await this.settleChildMutationWithoutExecution(
        scope,
        work,
        ownerEpoch,
        delegation,
        activeRun,
        toolWork,
        failedToolResult(new Error('APPROVAL_STALE')),
      );
      return;
    }
    if (toolWork.status === 'proposed' && inspectionChanged(toolWork.inspection, inspection)) {
      const refreshed = await this.stateCommit.refreshProposedTool({
        scope,
        runId: work.runId,
        toolStepId: toolWork.toolStepId,
        toolCallId: toolWork.toolCallId,
        expectedRunVersion: activeRun.version,
        inspection,
        now: this.clock.nowUnixSeconds(),
      });
      activeRun = refreshed.run;
      this.events.publishRunWake(work.runId, refreshed.eventCursor);
    }

    const duplicate = await this.runs.confirmedMutation(scope, work.runId, inspection.operationHash);
    if (duplicate && duplicate.toolCallId !== toolWork.toolCallId) {
      await this.settleChildMutationWithoutExecution(
        scope,
        work,
        ownerEpoch,
        delegation,
        activeRun,
        toolWork,
        failedToolResult(new Error('MUTATION_ALREADY_CONFIRMED')),
      );
      return;
    }

    let approvalId = toolWork.approvalId;
    if (toolWork.status === 'proposed') {
      approvalId = randomUUID();
      const now = this.clock.nowUnixSeconds();
      const requested = await this.stateCommit.requestToolApproval({
        scope,
        runId: work.runId,
        runtimeId: work.agentRuntimeId,
        toolStepId: toolWork.toolStepId,
        toolCallId: toolWork.toolCallId,
        approvalId,
        expectedRunVersion: activeRun.version,
        inspection,
        expiresAt: now + TOOL_APPROVAL_TTL_SECONDS,
        now,
      });
      this.events.publishRunWake(work.runId, requested.eventCursor);
      const expectedApprovalVersion = 1;
      const idempotencyKey = randomUUID();
      const resolved = await this.stateCommit.resolveToolApproval({
        scope,
        runId: work.runId,
        approvalId,
        decision: 'approved',
        operationHash: inspection.operationHash,
        expectedApprovalVersion,
        expectedRunVersion: requested.run.version,
        expectedPolicyRevision: inspection.policyRevision,
        expectedInputRevision: inspection.inputRevision,
        decidedByUserId: scope.userId,
        resolutionSource: 'full_access',
        idempotencyKey,
        requestHash: requestHash(1, {
          approvalId,
          runId: work.runId,
          decision: 'approved',
          operationHash: inspection.operationHash,
          expectedVersion: expectedApprovalVersion,
        }),
        now: this.clock.nowUnixSeconds(),
      });
      activeRun = resolved.run;
      this.events.publishRunWake(work.runId, resolved.eventCursor);
    }
    if (!approvalId) {
      await this.work.settleWork(work.id, ownerEpoch, 'cancelled', this.clock.nowUnixSeconds());
      return;
    }

    const leaseTtlSeconds = toolLeaseTtlSeconds(activeRun.budget.toolTimeoutSeconds);
    let mutationLease: Awaited<ReturnType<ToolCallRunner['acquireMutation']>>;
    try {
      mutationLease = await this.toolCalls.acquireMutation({
        runtimeId: work.agentRuntimeId,
        operationId: toolWork.toolCallId,
        resourceKeys: inspection.resourceKeys,
        ttlSeconds: leaseTtlSeconds,
        signal,
        deadlineAt: Math.min(delegation.deadlineAt, work.deadlineAt),
      });
    } catch (error) {
      await this.settleChildMutationWithoutExecution(
        scope,
        work,
        ownerEpoch,
        delegation,
        activeRun,
        { ...toolWork, status: 'ready', approvalId },
        failedToolResult(error),
      );
      return;
    }

    try {
      const begun = await this.stateCommit.beginSubagentMutationTool({
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
      });
      this.events.publishRunWake(work.runId, begun.eventCursor);

      const toolResult = await this.toolCalls.executeMutation(
        mutationLease,
        this.toolContext(
          begun.run,
          work.agentRuntimeId,
          toolWork.toolStepId,
          mutationLease.signal,
          Math.min(delegation.deadlineAt, work.deadlineAt),
          toolWork.toolCallId,
        ),
        inspection,
      );
      if (toolResult.outcome !== 'confirmed') {
        await this.toolCalls
          .quarantineMutation(mutationLease, 'SUBAGENT_MUTATION_OUTCOME_UNKNOWN', {
            toolCallId: toolWork.toolCallId,
            runtimeId: work.agentRuntimeId,
            errorCode: toolResult.errorCode ?? 'UNKNOWN',
          })
          .catch(() => undefined);
      }

      let settled;
      try {
        settled = await this.stateCommit.settleSubagentTool({
          scope,
          runId: work.runId,
          runtimeId: work.agentRuntimeId,
          delegationId: delegation.id,
          workId: work.id,
          ownerEpoch,
          toolStepId: toolWork.toolStepId,
          toolCallId: toolWork.toolCallId,
          result: toolResult,
          ...(toolResult.outcome === 'unknown' ? { needsReconciliation: true } : {}),
          continuation: 'runnable',
          now: this.clock.nowUnixSeconds(),
        });
      } catch (error) {
        await this.toolCalls
          .quarantineMutation(mutationLease, 'STATE_COMMIT_FAILED_AFTER_SUBAGENT_MUTATION', {
            toolCallId: toolWork.toolCallId,
            runtimeId: work.agentRuntimeId,
            errorCode: errorCode(error),
          })
          .catch(() => undefined);
        throw error;
      }
      this.events.publishRunWake(work.runId, settled.eventCursor);
      if (toolResult.outcome !== 'confirmed') return;

      let finalized = settled;
      const leaseFinalization = await this.toolCalls.confirmMutation(mutationLease);
      if (!leaseFinalization.ok) {
        finalized = await this.stateCommit.commit({
          scope,
          runId: settled.run.id,
          expectedRunVersion: settled.run.version,
          events: [
            {
              type: 'run.reconciliation_required',
              payload: {
                kind: 'lease_finalization',
                mutationOutcome: 'confirmed',
                toolCallId: leaseFinalization.toolCallId,
                resourceKeys: leaseFinalization.resourceKeys,
                reason: leaseFinalization.reason,
                errorCode: leaseFinalization.errorCode,
                runtimeId: work.agentRuntimeId,
              },
            },
          ],
          runPatch: { needsReconciliation: true },
          now: this.clock.nowUnixSeconds(),
        });
        this.events.publishRunWake(work.runId, finalized.eventCursor);
      }

      if (finalized.run.status === 'running' && !finalized.run.needsReconciliation) {
        const guarded = await this.stateCommit.evaluateToolLoopGuard({
          scope,
          runId: work.runId,
          runtimeId: work.agentRuntimeId,
          delegationId: delegation.id,
          expectedRunVersion: finalized.run.version,
          observations: [
            {
              toolName: inspection.toolName,
              risk: inspection.risk,
              operationHash: inspection.operationHash,
              result: toolResult,
            },
          ],
          now: this.clock.nowUnixSeconds(),
        });
        if (guarded.run.version !== finalized.run.version) this.events.publishRunWake(work.runId, guarded.eventCursor);
        finalized = guarded;
      }
      if (finalized.run.status === 'running' && !finalized.run.needsReconciliation) {
        await this.recoverySafePoint(finalized.run, 'mutation_confirmed');
      }
    } finally {
      await this.toolCalls.cleanupMutation(mutationLease);
    }
  }

  private async settleChildMutationWithoutExecution(
    scope: Scope,
    work: SchedulerWorkView,
    ownerEpoch: number,
    delegation: DelegationView,
    run: RunView,
    toolWork: NonNullable<Awaited<ReturnType<RuntimeParticipantRepositoryPort['runtimeToolWork']>>>,
    result: ToolResult,
  ): Promise<void> {
    let begunRun = run;
    if (toolWork.status === 'ready') {
      if (!toolWork.approvalId) {
        await this.work.settleWork(work.id, ownerEpoch, 'cancelled', this.clock.nowUnixSeconds());
        return;
      }
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
      begunRun = begun.run;
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
      begunRun = begun.run;
      this.events.publishRunWake(work.runId, begun.eventCursor);
    } else {
      await this.work.settleWork(work.id, ownerEpoch, 'cancelled', this.clock.nowUnixSeconds());
      return;
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
    void begunRun;
  }

  private async executeChild(
    scope: Scope,
    work: SchedulerWorkView,
    ownerEpoch: number,
    signal: AbortSignal,
  ): Promise<void> {
    const payload = work.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.delegationId !== 'string') {
      await this.work.settleWork(work.id, ownerEpoch, 'cancelled', this.clock.nowUnixSeconds());
      return;
    }
    const delegation = await this.delegations.delegation(scope, work.runId, payload.delegationId);
    const run = await this.runs.snapshot(scope, work.runId);
    if (!delegation || !run || terminalDelegation(delegation) || run.status !== 'running') {
      await this.work.settleWork(work.id, ownerEpoch, 'cancelled', this.clock.nowUnixSeconds());
      return;
    }
    if (delegation.deadlineAt <= this.clock.nowUnixSeconds()) {
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
      await this.sendCompletion(scope, work.runId, delegation, 'failed', '', 'DELEGATION_DEADLINE_EXCEEDED').catch(
        () => undefined,
      );
      if (delegation.failureMode === 'failFast') await this.cancelSiblings(scope, delegation);
      await this.resumeParent(scope, work.runId, delegation);
      return;
    }

    const interruptedModel = await this.runtimes.activeRuntimeModelWork(scope, work.runId, work.agentRuntimeId);
    if (interruptedModel) {
      const settled = await this.stateCommit.settleSubagentModelStep({
        scope,
        runId: work.runId,
        runtimeId: work.agentRuntimeId,
        delegationId: delegation.id,
        workId: work.id,
        ownerEpoch,
        stepId: interruptedModel.stepId,
        attemptId: interruptedModel.attemptId,
        outcome: 'failed',
        result: { errorCode: 'SUBAGENT_MODEL_INTERRUPTED' },
        evidenceRefs: [],
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        estimatedUsage: true,
        finishReason: null,
        errorCode: 'SUBAGENT_MODEL_INTERRUPTED',
        now: this.clock.nowUnixSeconds(),
      });
      this.events.publishRunWake(work.runId, settled.eventCursor);
      await this.sendCompletion(scope, work.runId, delegation, 'failed', '', 'SUBAGENT_MODEL_INTERRUPTED').catch(
        () => undefined,
      );
      if (delegation.failureMode === 'failFast') await this.cancelSiblings(scope, delegation);
      await this.resumeParent(scope, work.runId, delegation);
      return;
    }

    const provider = await this.providers.get(scope.userId, delegation.modelRef.providerId);
    if (!provider.enabled || provider.version !== delegation.modelRef.configurationVersion) {
      await this.failBeforeModel(scope, work, delegation, ownerEpoch, 'SUBAGENT_MODEL_UNAVAILABLE');
      return;
    }
    const configuredModel = provider.models.find((candidate) => candidate.id === delegation.modelRef.modelId);
    if (!configuredModel) {
      await this.failBeforeModel(scope, work, delegation, ownerEpoch, 'SUBAGENT_MODEL_UNAVAILABLE');
      return;
    }
    const model = applyModelCapabilitySnapshot(configuredModel, delegation.modelCapabilities);
    const preparedContext = await this.contextBuilder.prepare(
      scope,
      work.runId,
      work.agentRuntimeId,
      delegation,
      model,
      run,
    );
    if (preparedContext.kind === 'cancel') {
      await this.work.settleWork(work.id, ownerEpoch, 'cancelled', this.clock.nowUnixSeconds());
      return;
    }
    if (preparedContext.kind === 'fail') {
      await this.failBeforeModel(scope, work, delegation, ownerEpoch, preparedContext.code);
      return;
    }
    const { runtime, inbox, instructions, messages, offeredTools, toolMode, estimatedInputTokens, maxOutputTokens } =
      preparedContext.plan;
    const begun = await this.stateCommit.beginSubagentModelStep({
      scope,
      runId: work.runId,
      runtimeId: work.agentRuntimeId,
      delegationId: delegation.id,
      workId: work.id,
      ownerEpoch,
      reservedTokens: estimatedInputTokens + maxOutputTokens,
      now: this.clock.nowUnixSeconds(),
    });
    this.events.publishRunWake(work.runId, begun.run.eventCursor);

    let text = '';
    let usage: TokenUsage | undefined;
    let finishReason: ModelFinishReason | null = null;
    let providerContinuation: ModelProviderContinuation | undefined;
    const toolCalls = new Map<number, ToolCallAccumulator>();
    let outcome: 'completed' | 'failed' | 'cancelled' = 'completed';
    let failureCode: string | undefined;
    try {
      const releaseModelCall = await this.modelCalls.acquire(scope.userId, signal);
      try {
        for await (const event of this.modelPort.stream(
          {
            userId: scope.userId,
            providerId: delegation.modelRef.providerId,
            modelId: delegation.modelRef.modelId,
            configurationVersion: delegation.modelRef.configurationVersion,
            instructions,
            messages,
            ...(offeredTools.length > 0 ? { tools: offeredTools, toolMode } : {}),
            cache: {
              scopeKey: `nexus:subagent:${work.runId}:${delegation.id}`,
              affinityKey: `nexus:thread:${run.threadId}`,
              lineageKey: modelCacheLineageKey({ instructions, tools: offeredTools }),
            },
            ...(model.defaultReasoningEffort === undefined ? {} : { reasoningEffort: model.defaultReasoningEffort }),
            capabilitySnapshot: delegation.modelCapabilities,
            maxOutputTokens,
          },
          signal,
        )) {
          if (event.type === 'message.delta') {
            text += event.text;
            if (Buffer.byteLength(text, 'utf8') > MAX_CHILD_OUTPUT_BYTES) throw new Error('MODEL_RESPONSE_TOO_LARGE');
            this.events.publishTransient({
              runId: work.runId,
              type: 'message.delta',
              payload: {
                attemptId: begun.attemptId,
                attemptIndex: begun.attemptIndex,
                runtimeId: work.agentRuntimeId,
                delegationId: delegation.id,
                text: event.text,
              },
              occurredAt: this.clock.nowUnixSeconds(),
            });
          } else if (event.type === 'tool.delta') {
            const current = toolCalls.get(event.index) ?? { argumentsJson: '' };
            if (event.id !== undefined) current.id = event.id;
            if (event.name !== undefined) current.name = event.name;
            if (event.argumentsDelta !== undefined) current.argumentsJson += event.argumentsDelta;
            toolCalls.set(event.index, current);
          } else if (event.type === 'usage') {
            usage = event.usage;
          } else if (event.type === 'continuation') {
            providerContinuation = event.continuation;
          } else if (event.type === 'completed') {
            finishReason = event.finishReason;
          }
        }
      } finally {
        releaseModelCall();
      }
    } catch (error) {
      outcome = signal.aborted ? 'cancelled' : 'failed';
      failureCode = signal.aborted ? 'ABORTED' : errorCode(error);
    }
    const settledUsage: TokenUsage = usage ?? {
      inputTokens: estimatedInputTokens,
      outputTokens: text ? estimateTokens(text) : 0,
      cachedInputTokens: 0,
    };
    const finishDisposition = outcome === 'completed' ? modelFinishDisposition(finishReason, toolCalls.size) : null;
    if (finishDisposition?.kind === 'failed') {
      outcome = 'failed';
      failureCode = finishDisposition.errorCode;
    }
    if (outcome === 'completed' && finishDisposition?.kind === 'tool_calls') {
      if (toolMode === 'none' || offeredTools.length === 0) {
        outcome = 'failed';
        failureCode = 'SUBAGENT_TOOL_NOT_ALLOWED';
      } else if (toolCalls.size > 32) {
        outcome = 'failed';
        failureCode = 'MODEL_TOOL_CALL_BATCH_TOO_LARGE';
      } else {
        const orderedCalls = [...toolCalls.entries()].sort(([left], [right]) => left - right);
        const offeredToolNames = new Set(offeredTools.map((tool) => tool.name));
        const batchItems: Array<{
          providerCallId: string;
          toolCallId: string;
          toolName: string;
          toolVersion: string;
          inspection: ToolInspection;
          rejectedResult?: ToolResult;
        }> = [];
        let invalidProviderCall = false;
        for (const [, call] of orderedCalls) {
          if (!call?.id || !call.name) {
            invalidProviderCall = true;
            break;
          }
          const proposal: ToolProposal = {
            providerCallId: call.id,
            name: call.name,
            argumentsJson: call.argumentsJson || '{}',
          };
          if (
            !offeredToolNames.has(proposal.name) ||
            !this.contextBuilder.allowsTool(scope, delegation, proposal.name)
          ) {
            const rejectedResult = failedToolResult(new Error('SUBAGENT_TOOL_NOT_ALLOWED'));
            batchItems.push({
              providerCallId: proposal.providerCallId,
              toolCallId: randomUUID(),
              toolName: proposal.name,
              toolVersion: 'unavailable',
              inspection: rejectedToolInspection(begun.run, work.agentRuntimeId, proposal, 'SUBAGENT_TOOL_NOT_ALLOWED'),
              rejectedResult,
            });
            continue;
          }
          try {
            const inspection = await this.toolExecutor.inspect(
              this.toolContext(begun.run, work.agentRuntimeId, begun.stepId, signal, delegation.deadlineAt),
              proposal,
            );
            const rejectedResult =
              inspection.mutation && orderedCalls.length > 1
                ? failedToolResult(new Error('SUBAGENT_MUTATION_BATCH_FORBIDDEN'))
                : undefined;
            batchItems.push({
              providerCallId: proposal.providerCallId,
              toolCallId: randomUUID(),
              toolName: proposal.name,
              toolVersion: inspection.toolVersion,
              inspection,
              ...(rejectedResult ? { rejectedResult } : {}),
            });
          } catch (error) {
            const code = errorCode(error);
            batchItems.push({
              providerCallId: proposal.providerCallId,
              toolCallId: randomUUID(),
              toolName: proposal.name,
              toolVersion: 'unavailable',
              inspection: rejectedToolInspection(begun.run, work.agentRuntimeId, proposal, code),
              rejectedResult: failedToolResult(error),
            });
          }
        }
        if (invalidProviderCall) {
          outcome = 'failed';
          failureCode = 'MODEL_TOOL_CALL_INVALID';
        } else {
          try {
            const proposed = await this.stateCommit.commitSubagentToolProposalBatch({
              scope,
              runId: work.runId,
              runtimeId: work.agentRuntimeId,
              delegationId: delegation.id,
              workId: work.id,
              ownerEpoch,
              modelStepId: begun.stepId,
              attemptId: begun.attemptId,
              expectedRunVersion: begun.run.version,
              items: batchItems,
              inputTokens: settledUsage.inputTokens,
              outputTokens: settledUsage.outputTokens,
              cachedInputTokens: settledUsage.cachedInputTokens,
              estimatedUsage: usage === undefined,
              finishReason,
              ...(providerContinuation ? { providerContinuation } : {}),
              now: this.clock.nowUnixSeconds(),
            });
            this.events.publishRunWake(work.runId, proposed.eventCursor);
            if (inbox.length > 0) {
              const through = inbox.at(-1)?.recipientSequence ?? runtime.consumedMailboxSequence;
              await this.mailboxes
                .consumeMessages(
                  scope,
                  work.runId,
                  work.agentRuntimeId,
                  through,
                  runtime.consumedMailboxSequence,
                  this.clock.nowUnixSeconds(),
                )
                .catch(() => undefined);
            }
            return;
          } catch (error) {
            outcome = signal.aborted ? 'cancelled' : 'failed';
            failureCode = signal.aborted ? 'ABORTED' : errorCode(error);
          }
        }
      }
    }
    const completion = boundedUtf8(text, MAX_COMPLETION_BYTES);
    const verifiedEvidence = await this.verifiedRuntimeEvidence(scope, work.runId, work.agentRuntimeId).catch(() => ({
      artifactRefs: [] as string[],
      tools: [] as Array<{
        toolName: string;
        summary: string;
        verificationSummary: string;
        evidenceRefs: string[];
      }>,
    }));
    const evidenceRefs = verifiedEvidence.artifactRefs;
    const settled = await this.stateCommit.settleSubagentModelStep({
      scope,
      runId: work.runId,
      runtimeId: work.agentRuntimeId,
      delegationId: delegation.id,
      workId: work.id,
      ownerEpoch,
      stepId: begun.stepId,
      attemptId: begun.attemptId,
      outcome,
      result:
        outcome === 'completed'
          ? { summary: completion, finishReason, verifiedTools: verifiedEvidence.tools }
          : { summary: completion, errorCode: failureCode ?? 'SUBAGENT_EXECUTION_FAILED' },
      evidenceRefs,
      inputTokens: settledUsage.inputTokens,
      outputTokens: settledUsage.outputTokens,
      cachedInputTokens: settledUsage.cachedInputTokens,
      estimatedUsage: usage === undefined,
      finishReason,
      ...(outcome === 'completed' && providerContinuation ? { providerContinuation } : {}),
      ...(failureCode ? { errorCode: failureCode } : {}),
      now: this.clock.nowUnixSeconds(),
    });
    this.events.publishRunWake(work.runId, settled.eventCursor);

    if (inbox.length > 0 && outcome === 'completed') {
      const through = inbox.at(-1)?.recipientSequence ?? runtime.consumedMailboxSequence;
      await this.mailboxes
        .consumeMessages(
          scope,
          work.runId,
          work.agentRuntimeId,
          through,
          runtime.consumedMailboxSequence,
          this.clock.nowUnixSeconds(),
        )
        .catch(() => undefined);
    }
    await this.sendCompletion(scope, work.runId, delegation, outcome, completion, failureCode, evidenceRefs).catch(
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

  private async failBeforeModel(
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
    await this.sendCompletion(scope, work.runId, delegation, 'failed', '', code).catch(() => undefined);
    if (delegation.failureMode === 'failFast') await this.cancelSiblings(scope, delegation);
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

  private async verifiedRuntimeEvidenceRefs(scope: Scope, runId: string, runtimeId: string): Promise<string[]> {
    return (await this.verifiedRuntimeEvidence(scope, runId, runtimeId)).artifactRefs;
  }

  private async verifiedRuntimeEvidence(
    scope: Scope,
    runId: string,
    runtimeId: string,
  ): Promise<{
    artifactRefs: string[];
    tools: Array<{ toolName: string; summary: string; verificationSummary: string; evidenceRefs: string[] }>;
  }> {
    const exchanges = await this.runtimes.recentRuntimeToolExchanges(scope, runId, runtimeId, 32);
    const refs = new Set<string>();
    const tools: Array<{ toolName: string; summary: string; verificationSummary: string; evidenceRefs: string[] }> = [];
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

  private async cancelSiblings(scope: Scope, failed: DelegationView): Promise<void> {
    const siblings = await this.delegations.listDelegations(scope, failed.runId, failed.parentRuntimeId);
    for (const sibling of siblings) {
      if (sibling.id === failed.id || terminalDelegation(sibling)) continue;
      const descendants = await this.delegations.descendants(scope, failed.runId, sibling.childRuntimeId);
      for (const descendant of descendants) {
        if (!terminalDelegation(descendant)) {
          const cancelled = await this.delegations
            .cancelDelegation(scope, failed.runId, descendant.id, descendant.version, this.clock.nowUnixSeconds())
            .catch(() => null);
          if (cancelled) this.host.cancelChildRuntime(failed.runId, cancelled.childRuntimeId);
        }
      }
      const cancelled = await this.delegations
        .cancelDelegation(scope, failed.runId, sibling.id, sibling.version, this.clock.nowUnixSeconds())
        .catch(() => null);
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
