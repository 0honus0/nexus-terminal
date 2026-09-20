import { randomUUID } from 'node:crypto';
import type { ClockPort, JsonValue } from '../../agent.types';
import type { ToolContext, ToolInspection, ToolResult } from '../../capabilities/tool.types';
import type { BackendSignal } from './agent-backend.port';
import { executionErrorCode, executionErrorDetail } from './execution-errors';
import { ToolCallRunner } from './tool-call-runner';
import type { PendingRootTool, RunExecutionReaderPort } from '../runs/run.repository.port';
import type { RootExecutionCommitPort } from '../runs/state-commit.port';
import type { RunSnapshot, RunUsage, RunView } from '../runs/run.types';
import { normalizeUserInputQuestions } from '../runs/user-input-request';
import { mcpInputRequestFromToolResult } from '../runs/mcp-input-required';
import { TOOL_APPROVAL_TTL_SECONDS } from '../approvals/approval-policy';
import { toolLeaseTtlSeconds } from './tool-lease-policy';
import { requestHash } from '../runs/idempotency';
import { logger } from '../../../../shared/logging/logger';

const MAX_PARALLEL_READ_TOOLS = 4;

const rejectedToolResult = (errorCode: string, summary: string): ToolResult => ({
  ok: false,
  summary,
  data: { error: { code: errorCode, message: summary } },
  artifactRefs: [],
  truncated: false,
  outcome: 'confirmed',
  errorCode,
  verification: { status: 'failed', summary: 'The tool call was not executed.', evidenceRefs: [] },
});

const inspectionChanged = (left: ToolInspection, right: ToolInspection): boolean =>
  JSON.stringify(left) !== JSON.stringify(right);

const usageWithToolStep = (base: RunUsage): RunUsage => ({ ...base, steps: base.steps + 1 });

const errorCode = (error: unknown): string => executionErrorCode(error, 'MODEL_EXECUTION_FAILED');

const mutationLeaseFailureReason = (error: unknown, code: string, resourceKeys: readonly string[]): string => {
  const resources = resourceKeys.length > 0 ? resourceKeys.join(', ') : 'target resource';
  if (code === 'RESOURCE_QUARANTINED') {
    return `Cannot mutate ${resources}: the resource is quarantined after an earlier mutation with an unresolved outcome. Verify the actual state and reconcile it before retrying. [${code}]`;
  }
  if (code === 'LEASE_CONFLICT') {
    return `Cannot mutate ${resources}: another active operation currently holds its write lease. Wait for that operation to finish or stop it before retrying. [${code}]`;
  }
  if (code === 'LEASE_LOST') {
    return `Cannot mutate ${resources}: the write lease was lost before execution could start safely. [${code}]`;
  }
  const detail = executionErrorDetail(error, code);
  return `Cannot acquire the write lease for ${resources}: ${detail}${detail === code ? '' : ` [${code}]`}`;
};

const signalReason = (signal: AbortSignal): string | null => {
  if (!signal.aborted) return null;
  const reason = signal.reason;
  if (reason instanceof Error) return reason.message;
  return typeof reason === 'string' ? reason : 'ABORTED';
};

export type RootToolExecutionDisposition = 'continue' | 'return';

export const rootToolContext = (
  run: RunView,
  runtimeId: string,
  stepId: string,
  signal: AbortSignal,
  nowUnixSeconds: number,
  continuation?: JsonValue,
  toolCallId?: string,
): ToolContext => ({
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
  deadlineAt: nowUnixSeconds + run.budget.toolTimeoutSeconds,
  maxOutputBytes: run.budget.maxToolOutputBytes,
  inputRevision: run.inputRevision,
  ...(continuation === undefined ? {} : { continuation }),
});

export class RootToolExecutionCoordinator {
  constructor(
    private readonly repository: RunExecutionReaderPort,
    private readonly stateCommit: RootExecutionCommitPort,
    private readonly toolCalls: ToolCallRunner,
    private readonly clock: ClockPort,
    private readonly recoverySafePoint: (
      run: RunView,
      reason: 'model_boundary' | 'read_batch' | 'mutation_confirmed',
    ) => Promise<void>,
  ) {}

  async *execute(
    snapshot: RunSnapshot,
    pendingTools: readonly PendingRootTool[],
    signal: AbortSignal,
  ): AsyncGenerator<BackendSignal, RootToolExecutionDisposition> {
    const first = pendingTools[0];
    if (!first) return 'continue';

    if (snapshot.usage.steps >= snapshot.budget.maxRunSteps) {
      if (first.status === 'ready') {
        yield* this.supersedePendingMutationForBudget(snapshot, first);
      } else {
        yield* this.rejectPendingTool(
          snapshot,
          first,
          rejectedToolResult(
            'RUN_STEP_BUDGET_EXHAUSTED',
            'The Run step budget was exhausted before this queued tool call could execute.',
          ),
        );
      }
      return 'continue';
    }

    if (first.status === 'ready') {
      yield* this.executePendingMutation(snapshot, first, signal);
      return 'continue';
    }

    const scope = { userId: snapshot.userId, appId: snapshot.appId };
    if (first.inspection.inputRevision !== snapshot.inputRevision) {
      const continuation = await this.repository.inputContinuationForTool(scope, snapshot.id, first.toolCallId);
      if (continuation && !first.inspection.mutation) {
        let inspection: ToolInspection;
        let decision;
        try {
          ({ inspection, policyDecision: decision } = await this.toolCalls.refreshReadInspection(
            rootToolContext(snapshot, first.runtimeId, first.stepId, signal, this.clock.nowUnixSeconds()),
            first.inspection,
          ));
        } catch (error) {
          yield* this.rejectPendingTool(snapshot, first, this.toolCalls.failedProposal(error));
          return 'continue';
        }
        if (
          decision.action !== 'allow' ||
          inspection.mutation ||
          (inspection.risk !== 'read' && inspection.risk !== 'control')
        ) {
          yield* this.rejectPendingTool(
            snapshot,
            first,
            this.toolCalls.failedProposal(
              new Error(decision.action === 'deny' ? decision.reason : 'TOOL_POLICY_INVALID'),
            ),
          );
          return 'continue';
        }
        const refreshed = await this.stateCommit.refreshProposedTool({
          scope,
          runId: snapshot.id,
          toolStepId: first.stepId,
          toolCallId: first.toolCallId,
          expectedRunVersion: snapshot.version,
          inspection,
          now: this.clock.nowUnixSeconds(),
        });
        yield { type: 'durable', runId: snapshot.id, cursor: refreshed.eventCursor };
        return 'continue';
      }
      yield* this.rejectPendingTool(
        snapshot,
        first,
        rejectedToolResult(
          'TOOL_SUPERSEDED_BY_INPUT',
          'A newer user input superseded this tool call before it executed.',
        ),
      );
      return 'continue';
    }

    if (first.inspection.mutation) {
      const waiting = yield* this.preparePendingMutation(snapshot, first, signal);
      return waiting ? 'return' : 'continue';
    }

    const readWave = this.parallelReadWave(snapshot, pendingTools);
    yield* this.executePendingReadWave(snapshot, readWave, signal);
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

  private parallelReadWave(snapshot: RunSnapshot, pendingTools: readonly PendingRootTool[]): PendingRootTool[] {
    const first = pendingTools[0];
    if (!first || first.status !== 'proposed' || first.inspection.mutation) return first ? [first] : [];
    const remainingToolSteps = Math.max(0, snapshot.budget.maxRunSteps - snapshot.usage.steps);
    const limit = Math.min(MAX_PARALLEL_READ_TOOLS, remainingToolSteps);
    if (limit <= 1 || first.inspection.risk !== 'read') return [first];
    const availability = { environment: snapshot.definition.environment ?? null };
    if (
      !this.toolCalls.parallelSafe(
        { userId: snapshot.userId, appId: snapshot.appId },
        first.inspection.toolName,
        availability,
      )
    ) {
      return [first];
    }

    const selected: PendingRootTool[] = [];
    const resources = new Set<string>();
    for (const candidate of pendingTools) {
      if (selected.length >= limit) break;
      if (
        candidate.status !== 'proposed' ||
        candidate.inspection.mutation ||
        candidate.inspection.risk !== 'read' ||
        candidate.inspection.inputRevision !== snapshot.inputRevision ||
        !this.toolCalls.parallelSafe(
          { userId: snapshot.userId, appId: snapshot.appId },
          candidate.inspection.toolName,
          availability,
        ) ||
        candidate.inspection.resourceKeys.some((key) => resources.has(key))
      ) {
        break;
      }
      selected.push(candidate);
      for (const key of candidate.inspection.resourceKeys) resources.add(key);
    }
    return selected.length > 0 ? selected : [first];
  }

  private async *rejectPendingTool(
    snapshot: RunSnapshot | RunView,
    pending: PendingRootTool,
    result: ToolResult,
  ): AsyncGenerator<BackendSignal, void> {
    if (pending.status !== 'proposed') throw new Error('TOOL_STATE_CONFLICT');
    const rejected = await this.stateCommit.rejectProposedTool({
      scope: { userId: snapshot.userId, appId: snapshot.appId },
      runId: snapshot.id,
      toolStepId: pending.stepId,
      toolCallId: pending.toolCallId,
      expectedRunVersion: snapshot.version,
      providerCallId: pending.providerCallId,
      result,
      now: this.clock.nowUnixSeconds(),
    });
    yield { type: 'durable', runId: snapshot.id, cursor: rejected.eventCursor };
    if (rejected.run.status === 'running') {
      const guarded = await this.stateCommit.evaluateToolLoopGuard({
        scope: { userId: snapshot.userId, appId: snapshot.appId },
        runId: snapshot.id,
        runtimeId: pending.runtimeId,
        expectedRunVersion: rejected.run.version,
        observations: [
          {
            toolName: pending.inspection.toolName,
            risk: pending.inspection.risk,
            operationHash: pending.inspection.operationHash,
            result,
          },
        ],
        now: this.clock.nowUnixSeconds(),
      });
      if (guarded.run.version !== rejected.run.version) {
        yield { type: 'durable', runId: snapshot.id, cursor: guarded.eventCursor };
      }
      if (guarded.run.status === 'awaiting_input') yield { type: 'settled', run: guarded.run };
    }
  }

  private async *supersedePendingMutationForBudget(
    snapshot: RunSnapshot,
    pending: PendingRootTool,
  ): AsyncGenerator<BackendSignal, void> {
    if (pending.status !== 'ready' || !pending.approvalId) throw new Error('APPROVAL_STATE_INVALID');
    const superseded = await this.stateCommit.supersedeMutationTool({
      scope: { userId: snapshot.userId, appId: snapshot.appId },
      runId: snapshot.id,
      toolStepId: pending.stepId,
      toolCallId: pending.toolCallId,
      approvalId: pending.approvalId,
      expectedRunVersion: snapshot.version,
      reason: 'The Run step budget was exhausted before this approved mutation could execute.',
      errorCode: 'RUN_STEP_BUDGET_EXHAUSTED',
      details: { phase: 'budget', resourceKeys: pending.inspection.resourceKeys },
      now: this.clock.nowUnixSeconds(),
    });
    yield { type: 'durable', runId: snapshot.id, cursor: superseded.eventCursor };
  }

  private async *preparePendingMutation(
    snapshot: RunSnapshot,
    pending: PendingRootTool,
    signal: AbortSignal,
  ): AsyncGenerator<BackendSignal, boolean> {
    if (pending.status !== 'proposed' || !pending.inspection.mutation) throw new Error('TOOL_STATE_CONFLICT');
    const scope = { userId: snapshot.userId, appId: snapshot.appId };
    let currentRun: RunView = snapshot;
    let inspection: ToolInspection;
    let decision;
    try {
      ({ inspection, policyDecision: decision } = await this.toolCalls.refreshMutationInspection(
        rootToolContext(currentRun, pending.runtimeId, pending.stepId, signal, this.clock.nowUnixSeconds()),
        pending.inspection,
      ));
    } catch (error) {
      yield* this.rejectPendingTool(snapshot, pending, this.toolCalls.failedProposal(error));
      return false;
    }
    if (decision.action !== 'requireApproval' || !inspection.mutation) {
      yield* this.rejectPendingTool(
        snapshot,
        pending,
        this.toolCalls.failedProposal(new Error(decision.action === 'deny' ? decision.reason : 'TOOL_POLICY_INVALID')),
      );
      return false;
    }
    if (inspectionChanged(pending.inspection, inspection)) {
      const refreshed = await this.stateCommit.refreshProposedTool({
        scope,
        runId: snapshot.id,
        toolStepId: pending.stepId,
        toolCallId: pending.toolCallId,
        expectedRunVersion: currentRun.version,
        inspection,
        now: this.clock.nowUnixSeconds(),
      });
      currentRun = refreshed.run;
      yield { type: 'durable', runId: snapshot.id, cursor: refreshed.eventCursor };
    }

    const confirmedMutation = await this.repository.confirmedMutation(scope, snapshot.id, inspection.operationHash);
    if (confirmedMutation && confirmedMutation.toolCallId !== pending.toolCallId) {
      const duplicate = rejectedToolResult(
        'MUTATION_ALREADY_CONFIRMED',
        'An identical mutation already completed successfully earlier in this Run. This duplicate proposal was not executed again.',
      );
      yield* this.rejectPendingTool(currentRun, { ...pending, inspection }, duplicate);
      return false;
    }

    const approvalId = randomUUID();
    const now = this.clock.nowUnixSeconds();
    const requested = await this.stateCommit.requestToolApproval({
      scope,
      runId: currentRun.id,
      runtimeId: pending.runtimeId,
      toolStepId: pending.stepId,
      toolCallId: pending.toolCallId,
      approvalId,
      expectedRunVersion: currentRun.version,
      inspection,
      expiresAt: now + TOOL_APPROVAL_TTL_SECONDS,
      now,
    });
    yield { type: 'durable', runId: snapshot.id, cursor: requested.eventCursor };
    if (snapshot.definition.approvalMode !== 'full_access') {
      yield { type: 'settled', run: requested.run };
      return true;
    }

    const expectedApprovalVersion = 1;
    const idempotencyKey = randomUUID();
    const resolved = await this.stateCommit.resolveToolApproval({
      scope,
      runId: requested.run.id,
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
        runId: requested.run.id,
        decision: 'approved',
        operationHash: inspection.operationHash,
        expectedVersion: expectedApprovalVersion,
      }),
      now: this.clock.nowUnixSeconds(),
    });
    logger.info(
      {
        runId: snapshot.id,
        toolCallId: pending.toolCallId,
        toolName: inspection.toolName,
        approvalId,
      },
      'Agent batch mutation auto-approved by full access mode',
    );
    yield { type: 'durable', runId: snapshot.id, cursor: resolved.eventCursor };
    return false;
  }

  private async *executePendingReadWave(
    snapshot: RunSnapshot,
    wave: readonly PendingRootTool[],
    signal: AbortSignal,
  ): AsyncGenerator<BackendSignal, void> {
    if (wave.length === 0) return;
    const scope = { userId: snapshot.userId, appId: snapshot.appId };
    const availability = { environment: snapshot.definition.environment ?? null };
    let currentRun: RunView = snapshot;
    const prepared: Array<{ pending: PendingRootTool; inspection: ToolInspection }> = [];
    const resourceKeys = new Set<string>();

    for (const pending of wave) {
      if (pending.status !== 'proposed' || pending.inspection.mutation) break;
      const inspection = pending.inspection;
      const decision = this.toolCalls.decision(inspection);
      if (decision.action !== 'allow' || inspection.mutation || !['read', 'control'].includes(inspection.risk)) {
        if (prepared.length > 0) break;
        yield* this.rejectPendingTool(
          currentRun,
          pending,
          this.toolCalls.failedProposal(
            new Error(decision.action === 'deny' ? decision.reason : 'TOOL_POLICY_INVALID'),
          ),
        );
        return;
      }
      if (prepared.length > 0) {
        if (
          inspection.risk !== 'read' ||
          !this.toolCalls.parallelSafe(scope, inspection.toolName, availability) ||
          inspection.resourceKeys.some((key) => resourceKeys.has(key))
        ) {
          break;
        }
      }
      prepared.push({ pending, inspection });
      for (const key of inspection.resourceKeys) resourceKeys.add(key);
      if (inspection.risk === 'control') break;
    }
    if (prepared.length === 0) return;

    const begun = await this.stateCommit.beginReadToolBatch({
      scope,
      runId: currentRun.id,
      runtimeId: prepared[0]!.pending.runtimeId,
      expectedRunVersion: currentRun.version,
      items: prepared.map(({ pending }) => ({ toolStepId: pending.stepId, toolCallId: pending.toolCallId })),
      now: this.clock.nowUnixSeconds(),
    });
    yield { type: 'durable', runId: snapshot.id, cursor: begun.eventCursor };

    const executions = await Promise.all(
      prepared.map(async ({ pending, inspection }) => {
        const readLeaseTtlSeconds = toolLeaseTtlSeconds(begun.run.budget.toolTimeoutSeconds);
        const inputContinuation = await this.repository.inputContinuationForTool(
          scope,
          begun.run.id,
          pending.toolCallId,
        );
        const continuation = inputContinuation
          ? ({
              continuation: inputContinuation.continuation,
              answerText: inputContinuation.answerText,
            } satisfies JsonValue)
          : undefined;
        let lease: Awaited<ReturnType<ToolCallRunner['acquireRead']>> | null = null;
        let result: ToolResult;
        try {
          lease = await this.toolCalls.acquireRead(
            rootToolContext(
              begun.run,
              pending.runtimeId,
              pending.stepId,
              signal,
              this.clock.nowUnixSeconds(),
              continuation,
            ),
            inspection,
            readLeaseTtlSeconds,
          );
          result = await this.toolCalls.executeRead(
            lease,
            rootToolContext(
              begun.run,
              pending.runtimeId,
              pending.stepId,
              lease.signal,
              this.clock.nowUnixSeconds(),
              continuation,
            ),
            inspection,
          );
        } catch (error) {
          result = this.toolCalls.failedRead(error);
        } finally {
          if (lease) await this.toolCalls.releaseRead(lease);
        }
        logger.info(
          {
            runId: snapshot.id,
            threadId: snapshot.threadId,
            toolCallId: pending.toolCallId,
            toolName: inspection.toolName,
            ok: result.ok,
            outcome: result.outcome,
            errorCode: result.errorCode ?? null,
          },
          'Agent batch read/control tool execution completed',
        );
        return { pending, inspection, result };
      }),
    );

    const mcpInputExecution =
      executions.length === 1 && executions[0]?.result.errorCode === 'MCP_INPUT_REQUIRED' ? executions[0] : null;
    if (mcpInputExecution) {
      try {
        const request = mcpInputRequestFromToolResult(mcpInputExecution.result);
        if (!request) throw new Error('MCP_INPUT_REQUIRED_INVALID');
        const parked = await this.stateCommit.parkMcpInputRequiredTool({
          scope,
          runId: begun.run.id,
          runtimeId: mcpInputExecution.pending.runtimeId,
          toolStepId: mcpInputExecution.pending.stepId,
          toolCallId: mcpInputExecution.pending.toolCallId,
          expectedRunVersion: begun.run.version,
          providerCallId: mcpInputExecution.pending.providerCallId,
          requestId: randomUUID(),
          questions: request.questions,
          continuation: request.continuation,
          now: this.clock.nowUnixSeconds(),
        });
        yield { type: 'durable', runId: snapshot.id, cursor: parked.eventCursor };
        yield { type: 'settled', run: parked.run };
        return;
      } catch (error) {
        mcpInputExecution.result = this.toolCalls.failedRead(error);
      }
    }

    const inputRequestExecution =
      executions.length === 1 &&
      executions[0]?.inspection.toolName === 'request_user_input' &&
      executions[0].result.ok &&
      executions[0].result.outcome === 'confirmed'
        ? executions[0]
        : null;
    if (inputRequestExecution) {
      const normalized = inputRequestExecution.inspection.normalizedArguments;
      if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
        throw new Error('USER_INPUT_REQUEST_INVALID');
      }
      const questions = normalizeUserInputQuestions((normalized as Record<string, JsonValue>).questions);
      const parked = await this.stateCommit.settleUserInputRequestTool({
        scope,
        runId: begun.run.id,
        runtimeId: inputRequestExecution.pending.runtimeId,
        toolStepId: inputRequestExecution.pending.stepId,
        toolCallId: inputRequestExecution.pending.toolCallId,
        expectedRunVersion: begun.run.version,
        toolResultEntryId: randomUUID(),
        providerCallId: inputRequestExecution.pending.providerCallId,
        requestId: randomUUID(),
        questions,
        result: inputRequestExecution.result,
        now: this.clock.nowUnixSeconds(),
      });
      yield { type: 'durable', runId: snapshot.id, cursor: parked.eventCursor };
      yield { type: 'settled', run: parked.run };
      return;
    }

    const settled = await this.stateCommit.settleReadToolBatch({
      scope,
      runId: begun.run.id,
      runtimeId: prepared[0]!.pending.runtimeId,
      expectedRunVersion: begun.run.version,
      items: executions.map(({ pending, result }) => ({
        toolStepId: pending.stepId,
        toolCallId: pending.toolCallId,
        toolResultEntryId: randomUUID(),
        providerCallId: pending.providerCallId,
        result,
      })),
      now: this.clock.nowUnixSeconds(),
    });
    yield { type: 'durable', runId: snapshot.id, cursor: settled.eventCursor };
    if (['cancelled', 'interrupted', 'failed'].includes(settled.run.status)) {
      yield { type: 'settled', run: settled.run };
      return;
    }

    const mailboxFailure = executions.find(
      ({ inspection, result }) =>
        inspection.toolName === 'send_agent_message' &&
        (result.errorCode === 'MAILBOX_BUDGET_EXCEEDED' || result.errorCode === 'MAILBOX_HARD_LIMIT_EXCEEDED'),
    );
    if (mailboxFailure) {
      const mailboxError = mailboxFailure.result.errorCode!;
      const paused = await this.stateCommit.pauseRuntimeForBudget({
        scope,
        runId: settled.run.id,
        runtimeId: prepared[0]!.pending.runtimeId,
        expectedRunVersion: settled.run.version,
        budgetReason: {
          scope: 'mailbox',
          canIncrease: mailboxError === 'MAILBOX_BUDGET_EXCEEDED',
          errorCode: mailboxError,
          messages: settled.run.usage.subagentMessages,
          bytes: settled.run.usage.subagentMessageBytes,
          maxMessages: settled.run.budget.maxSubagentMessages,
          maxBytes: settled.run.budget.maxSubagentMessageBytes,
        },
        now: this.clock.nowUnixSeconds(),
      });
      yield { type: 'durable', runId: snapshot.id, cursor: paused.eventCursor };
      yield { type: 'settled', run: paused.run };
      return;
    }

    const blockedJoin = executions.find(
      ({ inspection, result }) =>
        inspection.toolName === 'join_subagents' &&
        result.ok &&
        result.data &&
        typeof result.data === 'object' &&
        !Array.isArray(result.data) &&
        result.data.ready === false,
    );
    if (blockedJoin) {
      const parked = await this.stateCommit.parkRuntime({
        scope,
        runId: settled.run.id,
        runtimeId: prepared[0]!.pending.runtimeId,
        expectedRunVersion: settled.run.version,
        reason: 'waiting_subagents',
        now: this.clock.nowUnixSeconds(),
      });
      yield { type: 'durable', runId: snapshot.id, cursor: parked.eventCursor };
      yield { type: 'settled', run: parked.run };
      return;
    }

    const guarded = await this.stateCommit.evaluateToolLoopGuard({
      scope,
      runId: settled.run.id,
      runtimeId: prepared[0]!.pending.runtimeId,
      expectedRunVersion: settled.run.version,
      observations: executions.map(({ inspection, result }) => ({
        toolName: inspection.toolName,
        risk: inspection.risk,
        operationHash: inspection.operationHash,
        result,
      })),
      now: this.clock.nowUnixSeconds(),
    });
    if (guarded.run.version !== settled.run.version) {
      yield { type: 'durable', runId: snapshot.id, cursor: guarded.eventCursor };
    }
    if (guarded.run.status === 'running' && !guarded.run.needsReconciliation) {
      await this.recoverySafePoint(guarded.run, 'read_batch');
    }
    if (guarded.run.status === 'awaiting_input') yield { type: 'settled', run: guarded.run };
  }

  private async *executePendingMutation(
    snapshot: RunSnapshot,
    pending: PendingRootTool,
    signal: AbortSignal,
  ): AsyncIterable<BackendSignal> {
    if (pending.status !== 'ready' || !pending.approvalId || pending.approvalVersion === null) {
      throw new Error('APPROVAL_STATE_INVALID');
    }
    const approvalId = pending.approvalId;
    const scope = { userId: snapshot.userId, appId: snapshot.appId };
    const context = rootToolContext(snapshot, pending.runtimeId, pending.stepId, signal, this.clock.nowUnixSeconds());
    let inspection;
    let decision;
    try {
      ({ inspection, policyDecision: decision } = await this.toolCalls.refreshMutationInspection(
        context,
        pending.inspection,
      ));
    } catch (error) {
      const code = errorCode(error);
      const detail = executionErrorDetail(error, code);
      const superseded = await this.stateCommit.supersedeMutationTool({
        scope,
        runId: snapshot.id,
        toolStepId: pending.stepId,
        toolCallId: pending.toolCallId,
        approvalId,
        expectedRunVersion: snapshot.version,
        reason: `Approved operation could not be re-inspected safely: ${detail}${detail === code ? '' : ` [${code}]`}`,
        errorCode: code,
        details: { phase: 'reinspect', resourceKeys: pending.inspection.resourceKeys },
        now: this.clock.nowUnixSeconds(),
      });
      yield { type: 'durable', runId: snapshot.id, cursor: superseded.eventCursor };
      return;
    }
    if (
      decision.action !== 'requireApproval' ||
      inspection.operationHash !== pending.inspection.operationHash ||
      inspection.inputRevision !== pending.inspection.inputRevision ||
      inspection.policyRevision !== pending.inspection.policyRevision
    ) {
      const superseded = await this.stateCommit.supersedeMutationTool({
        scope,
        runId: snapshot.id,
        toolStepId: pending.stepId,
        toolCallId: pending.toolCallId,
        approvalId,
        expectedRunVersion: snapshot.version,
        reason:
          'The target, preconditions, input, or policy changed after approval; the approved mutation was not executed.',
        errorCode: 'APPROVAL_STALE',
        details: {
          phase: 'approval_refresh',
          resourceKeys: inspection.resourceKeys,
          targetChanged: inspection.operationHash !== pending.inspection.operationHash,
          inputChanged: inspection.inputRevision !== pending.inspection.inputRevision,
          policyChanged: inspection.policyRevision !== pending.inspection.policyRevision,
        },
        now: this.clock.nowUnixSeconds(),
      });
      yield { type: 'durable', runId: snapshot.id, cursor: superseded.eventCursor };
      return;
    }

    const confirmedMutation = await this.repository.confirmedMutation(scope, snapshot.id, inspection.operationHash);
    if (confirmedMutation && confirmedMutation.toolCallId !== pending.toolCallId) {
      const superseded = await this.stateCommit.supersedeMutationTool({
        scope,
        runId: snapshot.id,
        toolStepId: pending.stepId,
        toolCallId: pending.toolCallId,
        approvalId,
        expectedRunVersion: snapshot.version,
        reason:
          'An identical mutation already completed successfully earlier in this Run. This duplicate proposal was not executed again.',
        errorCode: 'MUTATION_ALREADY_CONFIRMED',
        details: {
          phase: 'duplicate_guard',
          operationHash: inspection.operationHash,
          previousToolCallId: confirmedMutation.toolCallId,
          previousProviderCallId: confirmedMutation.providerCallId,
          resourceKeys: inspection.resourceKeys,
        },
        now: this.clock.nowUnixSeconds(),
      });
      yield { type: 'durable', runId: snapshot.id, cursor: superseded.eventCursor };
      return;
    }

    const leaseTtlSeconds = toolLeaseTtlSeconds(snapshot.budget.toolTimeoutSeconds);
    let mutationLease: Awaited<ReturnType<ToolCallRunner['acquireMutation']>>;
    try {
      mutationLease = await this.toolCalls.acquireMutation({
        runtimeId: pending.runtimeId,
        operationId: pending.toolCallId,
        resourceKeys: inspection.resourceKeys,
        ttlSeconds: leaseTtlSeconds,
        signal,
        deadlineAt: context.deadlineAt,
      });
    } catch (error) {
      const code = errorCode(error);
      const superseded = await this.stateCommit.supersedeMutationTool({
        scope,
        runId: snapshot.id,
        toolStepId: pending.stepId,
        toolCallId: pending.toolCallId,
        approvalId,
        expectedRunVersion: snapshot.version,
        reason: mutationLeaseFailureReason(error, code, inspection.resourceKeys),
        errorCode: code,
        details: { phase: 'lease_acquire', resourceKeys: inspection.resourceKeys },
        now: this.clock.nowUnixSeconds(),
      });
      yield { type: 'durable', runId: snapshot.id, cursor: superseded.eventCursor };
      return;
    }
    try {
      const begun = await this.stateCommit.beginMutationTool({
        scope,
        runId: snapshot.id,
        runtimeId: pending.runtimeId,
        toolStepId: pending.stepId,
        toolCallId: pending.toolCallId,
        approvalId,
        expectedRunVersion: snapshot.version,
        operationHash: inspection.operationHash,
        expectedPolicyRevision: inspection.policyRevision,
        expectedInputRevision: inspection.inputRevision,
        now: this.clock.nowUnixSeconds(),
      });
      yield { type: 'durable', runId: snapshot.id, cursor: begun.eventCursor };
      const toolResult = await this.toolCalls.executeMutation(
        mutationLease,
        rootToolContext(
          begun.run,
          pending.runtimeId,
          pending.stepId,
          mutationLease.signal,
          this.clock.nowUnixSeconds(),
          undefined,
          pending.toolCallId,
        ),
        inspection,
      );

      if (toolResult.outcome !== 'confirmed') {
        await this.toolCalls
          .quarantineMutation(mutationLease, 'MUTATION_OUTCOME_UNKNOWN', {
            toolCallId: pending.toolCallId,
            errorCode: toolResult.errorCode ?? 'UNKNOWN',
          })
          .catch((error) =>
            logger.error(
              {
                err: error,
                errorCode: errorCode(error),
                userId: snapshot.userId,
                appId: snapshot.appId,
                runId: snapshot.id,
                toolCallId: pending.toolCallId,
                toolName: inspection.toolName,
              },
              'Agent mutation quarantine failed after unknown tool outcome',
            ),
          );
      }

      let settled: Awaited<ReturnType<RootExecutionCommitPort['settleMutationTool']>>;
      try {
        settled = await this.stateCommit.settleMutationTool({
          scope,
          runId: begun.run.id,
          runtimeId: pending.runtimeId,
          toolStepId: pending.stepId,
          toolCallId: pending.toolCallId,
          expectedRunVersion: begun.run.version,
          toolResultEntryId: randomUUID(),
          providerCallId: pending.providerCallId,
          result: toolResult,
          usage: usageWithToolStep(begun.run.usage),
          needsReconciliation: toolResult.outcome === 'unknown',
          now: this.clock.nowUnixSeconds(),
        });
      } catch (error) {
        await this.toolCalls
          .quarantineMutation(mutationLease, 'STATE_COMMIT_FAILED_AFTER_MUTATION', {
            toolCallId: pending.toolCallId,
            errorCode: errorCode(error),
          })
          .catch((quarantineError) =>
            logger.error(
              {
                err: quarantineError,
                errorCode: errorCode(quarantineError),
                userId: snapshot.userId,
                appId: snapshot.appId,
                runId: snapshot.id,
                toolCallId: pending.toolCallId,
                toolName: inspection.toolName,
                originalErrorCode: errorCode(error),
              },
              'Agent mutation quarantine failed after state commit failure',
            ),
          );
        logger.error(
          {
            err: error,
            errorCode: errorCode(error),
            userId: snapshot.userId,
            appId: snapshot.appId,
            runId: snapshot.id,
            toolCallId: pending.toolCallId,
            toolName: inspection.toolName,
            mutationOutcome: toolResult.outcome,
          },
          'Agent mutation result state commit failed',
        );
        throw error;
      }

      let finalized = settled;
      if (toolResult.outcome === 'confirmed') {
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
                },
              },
            ],
            runPatch: { needsReconciliation: true },
            now: this.clock.nowUnixSeconds(),
          });
        }
      }

      if (finalized.run.status === 'running' && !finalized.run.needsReconciliation) {
        finalized = await this.stateCommit.evaluateToolLoopGuard({
          scope,
          runId: finalized.run.id,
          runtimeId: pending.runtimeId,
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
      }

      yield { type: 'durable', runId: snapshot.id, cursor: finalized.eventCursor };
      if (
        toolResult.outcome === 'confirmed' &&
        finalized.run.status === 'running' &&
        !finalized.run.needsReconciliation
      ) {
        await this.recoverySafePoint(finalized.run, 'mutation_confirmed');
      }
      if (finalized.run.status === 'interrupted' || finalized.run.status === 'awaiting_input') {
        yield { type: 'settled', run: finalized.run };
      }
    } finally {
      await this.toolCalls.cleanupMutation(mutationLease);
    }
  }
}
