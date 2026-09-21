import { randomUUID } from 'node:crypto';
import { logger } from '../../../../shared/logging/logger';
import type { ClockPort, JsonValue } from '../../agent.types';
import type { ToolInspection, ToolResult } from '../../capabilities/tool.types';
import type { BackendSignal } from './agent-backend.port';
import type { PendingRootTool, RunExecutionReaderPort } from '../runs/run.repository.port';
import type { RootExecutionCommitPort } from '../runs/state-commit.port';
import type { RunSnapshot, RunView } from '../runs/run.types';
import { mcpInputRequestFromToolResult } from '../runs/mcp-input-required';
import { normalizeUserInputQuestions } from '../runs/user-input-request';
import { rejectedRootToolResult, rootToolContext } from './root-tool-execution-common';
import { toolLeaseTtlSeconds } from './tool-lease-policy';
import { ToolCallRunner } from './tool-call-runner';

const MAX_PARALLEL_READ_TOOLS = 4;

export class RootReadToolExecutor {
  constructor(
    private readonly repository: RunExecutionReaderPort,
    private readonly stateCommit: RootExecutionCommitPort,
    private readonly toolCalls: ToolCallRunner,
    private readonly clock: ClockPort,
    private readonly recoverySafePoint: (run: RunView, reason: 'read_batch') => Promise<void>,
  ) {}

  async *refreshOrRejectSuperseded(
    snapshot: RunSnapshot,
    pending: PendingRootTool,
    signal: AbortSignal,
  ): AsyncGenerator<BackendSignal, void> {
    const scope = { userId: snapshot.userId, appId: snapshot.appId };
    const continuation = await this.repository.inputContinuationForTool(scope, snapshot.id, pending.toolCallId);
    if (continuation && !pending.inspection.mutation) {
      let inspection: ToolInspection;
      let decision;
      try {
        ({ inspection, policyDecision: decision } = await this.toolCalls.refreshReadInspection(
          rootToolContext(snapshot, pending.runtimeId, pending.stepId, signal, this.clock.nowUnixSeconds()),
          pending.inspection,
        ));
      } catch (error) {
        yield* this.rejectPending(snapshot, pending, this.toolCalls.failedProposal(error));
        return;
      }
      if (
        decision.action !== 'allow' ||
        inspection.mutation ||
        (inspection.risk !== 'read' && inspection.risk !== 'control')
      ) {
        yield* this.rejectPending(
          snapshot,
          pending,
          this.toolCalls.failedProposal(
            new Error(decision.action === 'deny' ? decision.reason : 'TOOL_POLICY_INVALID'),
          ),
        );
        return;
      }
      const refreshed = await this.stateCommit.refreshProposedTool({
        scope,
        runId: snapshot.id,
        toolStepId: pending.stepId,
        toolCallId: pending.toolCallId,
        expectedRunVersion: snapshot.version,
        inspection,
        now: this.clock.nowUnixSeconds(),
      });
      yield { type: 'durable', runId: snapshot.id, cursor: refreshed.eventCursor };
      return;
    }
    yield* this.rejectPending(
      snapshot,
      pending,
      rejectedRootToolResult(
        'TOOL_SUPERSEDED_BY_INPUT',
        'A newer user input superseded this tool call before it executed.',
      ),
    );
  }

  selectWave(snapshot: RunSnapshot, pendingTools: readonly PendingRootTool[]): PendingRootTool[] {
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

  async *rejectPending(
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

  async *execute(
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
        yield* this.rejectPending(
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
}
