import { randomUUID } from 'node:crypto';
import type { ClockPort, JsonValue } from '../../agent.types';
import type { ToolContext, ToolInspection, ToolResult } from '../../capabilities/tool.types';
import type { BackendSignal } from './agent-backend.port';
import { executionErrorCode, executionErrorDetail } from './execution-errors';
import { ToolCallRunner } from './tool-call-runner';
import {
  GovernedMutationExecutor,
  type GovernedMutationFailure,
  type GovernedMutationHooks,
} from './governed-mutation-executor';
import type { PendingRootTool, RunExecutionReaderPort } from '../runs/run.repository.port';
import type { RootExecutionCommitPort, StateCommitResult } from '../runs/state-commit.port';
import type { RunSnapshot, RunUsage, RunView } from '../runs/run.types';
import { normalizeUserInputQuestions } from '../runs/user-input-request';
import { mcpInputRequestFromToolResult } from '../runs/mcp-input-required';
import { toolLeaseTtlSeconds } from './tool-lease-policy';
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
  private readonly governedMutations: GovernedMutationExecutor;

  constructor(
    private readonly repository: RunExecutionReaderPort,
    private readonly stateCommit: RootExecutionCommitPort,
    private readonly toolCalls: ToolCallRunner,
    private readonly clock: ClockPort,
    private readonly recoverySafePoint: (
      run: RunView,
      reason: 'model_boundary' | 'read_batch' | 'mutation_confirmed',
    ) => Promise<void>,
  ) {
    this.governedMutations = new GovernedMutationExecutor(repository, stateCommit, toolCalls, () =>
      this.clock.nowUnixSeconds(),
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
    const availability = {
      environment: snapshot.definition.environment ?? null,
      connectionIds: snapshot.definition.connectionIds,
    };
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
    const commits: StateCommitResult[] = [];
    const hooks = this.rootMutationHooks(snapshot, pending, commits, 'prepare');
    const prepared = await this.governedMutations.prepare({
      scope: { userId: snapshot.userId, appId: snapshot.appId },
      runId: snapshot.id,
      runtimeId: pending.runtimeId,
      toolStepId: pending.stepId,
      toolCallId: pending.toolCallId,
      run: snapshot,
      inspection: pending.inspection,
      signal,
      autoApprove: snapshot.definition.approvalMode === 'full_access',
      hooks,
    });
    for (const commit of commits) yield { type: 'durable', runId: snapshot.id, cursor: commit.eventCursor };
    if (prepared.status === 'waiting_approval') {
      yield { type: 'settled', run: prepared.run };
      return true;
    }
    if (prepared.status === 'rejected') {
      if (prepared.run.status === 'awaiting_input') yield { type: 'settled', run: prepared.run };
      return false;
    }
    logger.info(
      {
        runId: snapshot.id,
        toolCallId: pending.toolCallId,
        toolName: prepared.inspection.toolName,
        approvalId: prepared.approvalId,
      },
      'Agent batch mutation auto-approved by full access mode',
    );
    return false;
  }

  private async *executePendingReadWave(
    snapshot: RunSnapshot,
    wave: readonly PendingRootTool[],
    signal: AbortSignal,
  ): AsyncGenerator<BackendSignal, void> {
    if (wave.length === 0) return;
    const scope = { userId: snapshot.userId, appId: snapshot.appId };
    const availability = {
      environment: snapshot.definition.environment ?? null,
      connectionIds: snapshot.definition.connectionIds,
    };
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
    const commits: StateCommitResult[] = [];
    const hooks = this.rootMutationHooks(snapshot, pending, commits, 'execute');
    const executed = await this.governedMutations.execute({
      scope: { userId: snapshot.userId, appId: snapshot.appId },
      runId: snapshot.id,
      runtimeId: pending.runtimeId,
      toolStepId: pending.stepId,
      toolCallId: pending.toolCallId,
      run: snapshot,
      inspection: pending.inspection,
      approvalId: pending.approvalId,
      signal,
      hooks,
    });
    for (const commit of commits) yield { type: 'durable', runId: snapshot.id, cursor: commit.eventCursor };
    if (executed.status === 'settled') {
      yield { type: 'durable', runId: snapshot.id, cursor: executed.commit.eventCursor };
      if (executed.run.status === 'interrupted' || executed.run.status === 'awaiting_input') {
        yield { type: 'settled', run: executed.run };
      }
    }
  }

  private rootMutationHooks(
    snapshot: RunSnapshot,
    pending: PendingRootTool,
    commits: StateCommitResult[],
    mode: 'prepare' | 'execute',
  ): GovernedMutationHooks {
    const scope = { userId: snapshot.userId, appId: snapshot.appId };
    return {
      context: (run, signal, toolCallId) =>
        rootToolContext(
          run,
          pending.runtimeId,
          pending.stepId,
          signal,
          this.clock.nowUnixSeconds(),
          undefined,
          toolCallId,
        ),
      validateInspection: (inspection, decision) => {
        if (decision.action === 'requireApproval' && inspection.mutation) return null;
        return new Error(decision.action === 'deny' ? decision.reason : 'TOOL_POLICY_INVALID');
      },
      failedResult: (error) => this.toolCalls.failedProposal(error),
      duplicateResult: () =>
        rejectedToolResult(
          'MUTATION_ALREADY_CONFIRMED',
          'An identical mutation already completed successfully earlier in this Run. This duplicate proposal was not executed again.',
        ),
      rejectProposed: async (run, inspection, result) => {
        const rejected = await this.stateCommit.rejectProposedTool({
          scope,
          runId: run.id,
          toolStepId: pending.stepId,
          toolCallId: pending.toolCallId,
          expectedRunVersion: run.version,
          providerCallId: pending.providerCallId,
          result,
          now: this.clock.nowUnixSeconds(),
        });
        commits.push(rejected);
        if (rejected.run.status !== 'running') return rejected;
        const guarded = await this.stateCommit.evaluateToolLoopGuard({
          scope,
          runId: rejected.run.id,
          runtimeId: pending.runtimeId,
          expectedRunVersion: rejected.run.version,
          observations: [
            {
              toolName: inspection.toolName,
              risk: inspection.risk,
              operationHash: inspection.operationHash,
              result,
            },
          ],
          now: this.clock.nowUnixSeconds(),
        });
        if (guarded.run.version !== rejected.run.version) commits.push(guarded);
        return guarded;
      },
      rejectReady: async (run, failure) => {
        const rejection = this.rootReadyMutationFailure(failure);
        const superseded = await this.stateCommit.supersedeMutationTool({
          scope,
          runId: run.id,
          toolStepId: pending.stepId,
          toolCallId: pending.toolCallId,
          approvalId: pending.approvalId!,
          expectedRunVersion: run.version,
          reason: rejection.reason,
          errorCode: rejection.errorCode,
          details: rejection.details,
          now: this.clock.nowUnixSeconds(),
        });
        commits.push(superseded);
        return superseded;
      },
      begin: (run, approvalId, inspection) =>
        this.stateCommit.beginMutationTool({
          scope,
          runId: run.id,
          runtimeId: pending.runtimeId,
          toolStepId: pending.stepId,
          toolCallId: pending.toolCallId,
          approvalId,
          expectedRunVersion: run.version,
          operationHash: inspection.operationHash,
          expectedPolicyRevision: inspection.policyRevision,
          expectedInputRevision: inspection.inputRevision,
          now: this.clock.nowUnixSeconds(),
        }),
      settle: (run, result) =>
        this.stateCommit.settleMutationTool({
          scope,
          runId: run.id,
          runtimeId: pending.runtimeId,
          toolStepId: pending.stepId,
          toolCallId: pending.toolCallId,
          expectedRunVersion: run.version,
          toolResultEntryId: randomUUID(),
          providerCallId: pending.providerCallId,
          result,
          usage: usageWithToolStep(run.usage),
          needsReconciliation: result.outcome === 'unknown',
          now: this.clock.nowUnixSeconds(),
        }),
      onCommit: (commit, phase) => {
        if (mode === 'prepare' || phase === 'begun') commits.push(commit);
      },
      recoverySafePoint: (run) => this.recoverySafePoint(run, 'mutation_confirmed'),
      unknownQuarantineReason: 'MUTATION_OUTCOME_UNKNOWN',
      commitFailureQuarantineReason: 'STATE_COMMIT_FAILED_AFTER_MUTATION',
      quarantineEvidence: (result, error) => ({
        toolCallId: pending.toolCallId,
        errorCode: error ? errorCode(error) : (result?.errorCode ?? 'UNKNOWN'),
      }),
    };
  }

  private rootReadyMutationFailure(failure: GovernedMutationFailure): {
    reason: string;
    errorCode: string;
    details: JsonValue;
  } {
    if (failure.phase === 'reinspect') {
      const detail = executionErrorDetail(failure.error, failure.errorCode);
      return {
        reason: `Approved operation could not be re-inspected safely: ${detail}${detail === failure.errorCode ? '' : ` [${failure.errorCode}]`}`,
        errorCode: failure.errorCode,
        details: { phase: 'reinspect', resourceKeys: failure.previousInspection.resourceKeys },
      };
    }
    if (failure.phase === 'approval_refresh') {
      return {
        reason:
          'The target, preconditions, input, or policy changed after approval; the approved mutation was not executed.',
        errorCode: 'APPROVAL_STALE',
        details: {
          phase: 'approval_refresh',
          resourceKeys: failure.inspection.resourceKeys,
          targetChanged: failure.inspection.operationHash !== failure.previousInspection.operationHash,
          inputChanged: failure.inspection.inputRevision !== failure.previousInspection.inputRevision,
          policyChanged: failure.inspection.policyRevision !== failure.previousInspection.policyRevision,
        },
      };
    }
    if (failure.phase === 'duplicate_guard') {
      return {
        reason:
          'An identical mutation already completed successfully earlier in this Run. This duplicate proposal was not executed again.',
        errorCode: 'MUTATION_ALREADY_CONFIRMED',
        details: {
          phase: 'duplicate_guard',
          operationHash: failure.inspection.operationHash,
          previousToolCallId: failure.duplicate?.toolCallId ?? null,
          previousProviderCallId: failure.duplicate?.providerCallId ?? null,
          resourceKeys: failure.inspection.resourceKeys,
        },
      };
    }
    return {
      reason: mutationLeaseFailureReason(failure.error, failure.errorCode, failure.inspection.resourceKeys),
      errorCode: failure.errorCode,
      details: { phase: 'lease_acquire', resourceKeys: failure.inspection.resourceKeys },
    };
  }
}
