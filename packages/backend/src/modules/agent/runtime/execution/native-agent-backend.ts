import { randomUUID } from 'node:crypto';
import type { ModelFinishReason, ModelProviderContinuation, TokenUsage } from '../../ai/model.types';
import type { ClockPort, JsonValue } from '../../agent.types';
import type { ToolContext, ToolInspection, ToolProposal, ToolResult } from '../../capabilities/tool.types';
import type { AgentBackendPort, BackendSignal } from './agent-backend.port';
import { completionGateDecision } from './completion-gate';
import { executionErrorCode, executionErrorDetail } from './execution-errors';
import { modelFinishDisposition } from './model-finish-policy';
import { ModelStepRunner, type ModelToolCall } from './model-step-runner';
import { estimateTokens } from './model-accounting';
import { ToolCallRunner } from './tool-call-runner';
import type { PendingRootTool, RunExecutionReaderPort } from '../runs/run.repository.port';
import type { DelegationReaderPort } from '../collaboration/subagent.repository.port';
import type { SubagentPolicyService } from '../collaboration/subagent-policy';
import { projectSubagentCollaborationContext } from '../collaboration/subagent-context-projection';
import type { RootExecutionCommitPort } from '../runs/state-commit.port';
import type { RunSnapshot, RunUsage, RunView } from '../runs/run.types';
import { runModelRoutes } from '../runs/model-routes';
import { normalizeUserInputQuestions } from '../runs/user-input-request';
import { TOOL_APPROVAL_TTL_SECONDS } from '../approvals/approval-policy';
import { toolLeaseTtlSeconds } from './tool-lease-policy';
import { requestHash } from '../runs/idempotency';
import { logger } from '../../../../shared/logging/logger';

const MAX_TOOL_CALLS_PER_MODEL_STEP = 64;
const MAX_PARALLEL_READ_TOOLS = 4;

const latestRunInputText = (run: RunSnapshot): string => {
  for (let index = run.recentEntries.length - 1; index >= 0; index -= 1) {
    const entry = run.recentEntries[index]!;
    if (
      entry.kind !== 'user_input' ||
      !entry.payload ||
      Array.isArray(entry.payload) ||
      typeof entry.payload !== 'object'
    ) {
      continue;
    }
    const text = (entry.payload as Record<string, JsonValue>).text;
    if (typeof text === 'string') return text;
  }
  return '';
};

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

const rejectedToolInspection = (run: RunView, proposal: ToolProposal, failureCode: string): ToolInspection => {
  const operationHash = requestHash(1, {
    kind: 'rejected_tool_call',
    runId: run.id,
    providerCallId: proposal.providerCallId,
    toolName: proposal.name,
    argumentsJson: proposal.argumentsJson,
    inputRevision: run.inputRevision,
    failureCode,
  });
  return {
    toolName: proposal.name,
    toolVersion: 'unavailable',
    normalizedArguments: {},
    target: {
      kind: 'run',
      targetIdentity: `run:${run.id}:rejected-tool:${proposal.providerCallId}`,
      endpoint: `run:${run.id}`,
      loginUser: `agent-runtime:${run.id}`,
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

const inspectionChanged = (left: ToolInspection, right: ToolInspection): boolean =>
  JSON.stringify(left) !== JSON.stringify(right);

const usageWithModel = (base: RunUsage, delta: TokenUsage): RunUsage => ({
  inputTokens: base.inputTokens + delta.inputTokens,
  outputTokens: base.outputTokens + delta.outputTokens,
  cachedInputTokens: base.cachedInputTokens + delta.cachedInputTokens,
  steps: base.steps + 1,
  subagentMessages: base.subagentMessages,
  subagentMessageBytes: base.subagentMessageBytes,
});

const usageWithAttempt = (base: RunUsage, delta: TokenUsage): RunUsage => ({
  inputTokens: base.inputTokens + delta.inputTokens,
  outputTokens: base.outputTokens + delta.outputTokens,
  cachedInputTokens: base.cachedInputTokens + delta.cachedInputTokens,
  steps: base.steps,
  subagentMessages: base.subagentMessages,
  subagentMessageBytes: base.subagentMessageBytes,
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

export class NativeAgentBackend implements AgentBackendPort {
  constructor(
    private readonly repository: RunExecutionReaderPort,
    private readonly delegations: DelegationReaderPort,
    private readonly stateCommit: RootExecutionCommitPort,
    private readonly modelSteps: ModelStepRunner,
    private readonly toolCalls: ToolCallRunner,
    private readonly clock: ClockPort,
    private readonly recoverySafePoint: (
      run: RunView,
      reason: 'model_boundary' | 'read_batch' | 'mutation_confirmed',
    ) => Promise<void> = async () => undefined,
    private readonly subagentPolicy: Pick<SubagentPolicyService, 'get'> | null = null,
  ) {}

  async *execute(initial: RunView, signal: AbortSignal): AsyncIterable<BackendSignal> {
    logger.debug(
      {
        runId: initial.id,
        threadId: initial.threadId,
        appId: initial.appId,
        userId: initial.userId,
        status: initial.status,
        providerId: initial.definition.model.providerId,
        modelId: initial.definition.model.modelId,
        reasoningEffort: initial.definition.reasoningEffort ?? null,
      },
      'Agent backend execution entered',
    );
    try {
      yield* this.executePersisted(initial, signal);
    } catch (error) {
      const abortReason = signalReason(signal);
      if (abortReason === 'NEW_INPUT' || abortReason === 'GOAL_UPDATED' || abortReason === 'AGENT_QUIESCE') return;

      const scope = { userId: initial.userId, appId: initial.appId };
      if (abortReason === 'CANCELLED') {
        const latest = await this.repository.snapshot(scope, initial.id);
        if (
          !latest ||
          ['completed', 'completed_unverified', 'failed', 'cancelled', 'interrupted'].includes(latest.status)
        ) {
          return;
        }
        if (latest.status === 'running' || latest.status === 'cancelling') {
          const cancelled = await this.cancelAtSafeBoundary(latest);
          yield { type: 'durable', runId: latest.id, cursor: cancelled.eventCursor };
          yield { type: 'settled', run: cancelled.run };
        }
        return;
      }

      const interrupted = await this.stateCommit.interruptUnexpectedRootExecution({
        scope,
        runId: initial.id,
        errorCode: errorCode(error),
        now: this.clock.nowUnixSeconds(),
      });
      if (!interrupted) return;
      yield { type: 'durable', runId: initial.id, cursor: interrupted.eventCursor };
      yield { type: 'settled', run: interrupted.run };
    }
  }

  private async *executePersisted(initial: RunView, signal: AbortSignal): AsyncIterable<BackendSignal> {
    const scope = { userId: initial.userId, appId: initial.appId };
    const runtimeId = await this.repository.rootRuntimeId(scope, initial.id);

    while (true) {
      const snapshot = await this.repository.snapshot(scope, initial.id);
      if (!snapshot) throw new Error('NOT_FOUND');
      if (!['created', 'running'].includes(snapshot.status)) return;

      if (signal.aborted) {
        const cancelled = await this.cancelAtSafeBoundary(snapshot);
        yield { type: 'durable', runId: snapshot.id, cursor: cancelled.eventCursor };
        yield { type: 'settled', run: cancelled.run };
        return;
      }

      const pendingTools = await this.repository.pendingTools(scope, snapshot.id);
      if (pendingTools.length > 0) {
        const first = pendingTools[0]!;
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
          continue;
        }
        if (first.status === 'ready') {
          yield* this.executePendingMutation(snapshot, first, signal);
          continue;
        }
        if (first.inspection.inputRevision !== snapshot.inputRevision) {
          yield* this.rejectPendingTool(
            snapshot,
            first,
            rejectedToolResult(
              'TOOL_SUPERSEDED_BY_INPUT',
              'A newer user input superseded this tool call before it executed.',
            ),
          );
          continue;
        }
        if (first.inspection.mutation) {
          const waiting = yield* this.preparePendingMutation(snapshot, first, signal);
          if (waiting) return;
          continue;
        }
        const readWave = this.parallelReadWave(snapshot, pendingTools);
        yield* this.executePendingReadWave(snapshot, readWave, signal);
        const pendingAbortReason = signalReason(signal);
        if (
          pendingAbortReason === 'NEW_INPUT' ||
          pendingAbortReason === 'GOAL_UPDATED' ||
          pendingAbortReason === 'AGENT_QUIESCE'
        ) {
          return;
        }
        continue;
      }

      await this.recoverySafePoint(snapshot, 'model_boundary');

      const remainingSteps = snapshot.budget.maxRunSteps - snapshot.usage.steps;
      const executionMode = snapshot.definition.executionMode ?? 'execute';
      const offeredTools = this.toolCalls.schemas(
        scope,
        { environment: snapshot.definition.environment ?? null },
        executionMode,
      );
      const toolMode: 'auto' | 'none' = remainingSteps >= 2 ? 'auto' : 'none';
      const projectionRunIds = [
        snapshot.id,
        ...Object.keys(snapshot.definition.contextBoundary?.runThrough ?? {}),
      ].filter((runId, index, values) => values.indexOf(runId) === index);
      const [projectionEntries, directSubagents, subagentSettings] = await Promise.all([
        Promise.all(
          projectionRunIds.map(async (runId) => [runId, await this.repository.inputProjection(scope, runId)] as const),
        ),
        this.delegations.listDelegations(scope, snapshot.id, runtimeId, 50),
        this.subagentPolicy?.get(scope) ?? Promise.resolve(null),
      ]);
      const inputProjections = Object.fromEntries(projectionEntries);
      const collaborationContext = projectSubagentCollaborationContext(subagentSettings, directSubagents);
      const currentModelRef = await this.repository.rootRuntimeModel(scope, snapshot.id);
      const frozenRoutes = runModelRoutes(snapshot.definition);
      let routeIndex = frozenRoutes.findIndex(
        (route) =>
          route.model.providerId === currentModelRef.providerId &&
          route.model.modelId === currentModelRef.modelId &&
          route.model.configurationVersion === currentModelRef.configurationVersion,
      );
      if (routeIndex < 0) routeIndex = 0;
      let activeRoute = frozenRoutes[routeIndex]!;
      let preparedModelStep;
      try {
        preparedModelStep = await this.modelSteps.prepare(
          snapshot,
          scope,
          offeredTools,
          inputProjections,
          collaborationContext,
          { model: activeRoute.model, capabilities: activeRoute.modelCapabilities },
          runtimeId,
        );
      } catch (error) {
        const code = errorCode(error);
        if (code !== 'PROVIDER_CONFIGURATION_STALE' && code !== 'MODEL_NOT_FOUND') throw error;
        const failed = await this.failAtSafeBoundary(snapshot, code);
        yield { type: 'durable', runId: snapshot.id, cursor: failed.eventCursor };
        yield { type: 'settled', run: failed.run };
        return;
      }
      let { model, contextPlan } = preparedModelStep;
      logger.debug(
        {
          runId: snapshot.id,
          threadId: snapshot.threadId,
          runVersion: snapshot.version,
          inputRevision: snapshot.inputRevision,
          usageSteps: snapshot.usage.steps,
          remainingSteps,
          modelId: model.id,
          reasoningEffort: snapshot.definition.reasoningEffort ?? null,
          toolMode,
          offeredToolCount: offeredTools.length,
          estimatedInputTokens: contextPlan.estimatedInputTokens,
          reservedOutputTokens: contextPlan.reservedOutputTokens,
          contextEpoch: contextPlan.contextEpoch,
        },
        'Agent model step prepared',
      );

      const budgetWait = await this.reserveModelBudget(snapshot);
      if (budgetWait) {
        yield { type: 'durable', runId: snapshot.id, cursor: budgetWait.eventCursor };
        yield { type: 'settled', run: budgetWait.run };
        return;
      }

      const worstCaseTokens = contextPlan.estimatedInputTokens + contextPlan.reservedOutputTokens;
      const begun = await this.stateCommit.beginModelStep({
        scope,
        runId: snapshot.id,
        runtimeId,
        expectedRunVersion: snapshot.version,
        inputWatermark: snapshot.inputRevision,
        reservedTokens: worstCaseTokens,
        estimatedInputTokens: contextPlan.estimatedInputTokens,
        heuristicInputTokens: contextPlan.heuristicInputTokens,
        contextSource: contextPlan.estimationSource,
        reservedOutputTokens: contextPlan.reservedOutputTokens,
        contextWindowTokens: model.contextWindow,
        contextEpoch: contextPlan.contextEpoch,
        model: activeRoute.model,
        now: this.clock.nowUnixSeconds(),
      });
      logger.debug(
        {
          runId: snapshot.id,
          stepId: begun.stepId,
          attemptId: begun.attemptId,
          attemptIndex: begun.attemptIndex,
          runVersion: begun.run.version,
          eventCursor: begun.run.eventCursor,
          reservedTokens: worstCaseTokens,
        },
        'Agent model step begun',
      );
      yield { type: 'durable', runId: snapshot.id, cursor: begun.run.eventCursor };

      let currentRun = begun.run;
      let currentAttemptId = begun.attemptId;
      let currentAttemptIndex = begun.attemptIndex;
      let routeAttemptIndex = 1;
      let text = '';
      let usage: TokenUsage | undefined;
      let finishReason: ModelFinishReason | null = null;
      let providerContinuation: ModelProviderContinuation | undefined;
      let modelStepClosed = false;
      let modelToolCalls = new Map<number, ModelToolCall>();

      try {
        while (true) {
          const attempt = yield* this.modelSteps.runAttempt(
            snapshot,
            contextPlan,
            { attemptId: currentAttemptId, attemptIndex: currentAttemptIndex },
            signal,
            toolMode,
            { model: activeRoute.model, capabilities: activeRoute.modelCapabilities },
          );
          text = attempt.text;
          usage = attempt.usage;
          finishReason = attempt.finishReason;
          providerContinuation = attempt.providerContinuation;
          modelToolCalls = attempt.toolCalls;
          logger.debug(
            {
              runId: snapshot.id,
              stepId: begun.stepId,
              attemptId: currentAttemptId,
              attemptIndex: currentAttemptIndex,
              finishReason,
              textBytes: Buffer.byteLength(text, 'utf8'),
              toolCallCount: modelToolCalls.size,
              inputTokens: usage?.inputTokens ?? null,
              outputTokens: usage?.outputTokens ?? null,
              cachedInputTokens: usage?.cachedInputTokens ?? null,
              errorCode: attempt.error ? errorCode(attempt.error) : null,
            },
            'Agent model attempt returned',
          );
          if (!attempt.error) break;

          const attemptError = attempt.error;
          const failedUsage: TokenUsage =
            usage ??
            ({
              inputTokens: contextPlan.estimatedInputTokens,
              outputTokens: text ? estimateTokens(text) : 0,
              cachedInputTokens: 0,
            } satisfies TokenUsage);
          const usageAfterFailed = usageWithAttempt(currentRun.usage, failedUsage);
          const budgetReason = this.retryBudgetReason(currentRun, usageAfterFailed);
          if (budgetReason) {
            const paused = await this.stateCommit.pauseModelStepForBudget({
              scope,
              runId: snapshot.id,
              runtimeId,
              stepId: begun.stepId,
              attemptId: currentAttemptId,
              expectedRunVersion: currentRun.version,
              usage: usageAfterFailed,
              inputTokens: failedUsage.inputTokens,
              outputTokens: failedUsage.outputTokens,
              cachedInputTokens: failedUsage.cachedInputTokens,
              estimatedUsage: usage === undefined,
              errorCode: errorCode(attemptError),
              budgetReason,
              now: this.clock.nowUnixSeconds(),
            });
            yield { type: 'durable', runId: snapshot.id, cursor: paused.eventCursor };
            yield { type: 'settled', run: paused.run };
            return;
          }

          if (this.modelSteps.shouldRetry(attemptError, routeAttemptIndex, signal)) {
            const nextAttemptIndex = currentAttemptIndex + 1;
            await this.modelSteps.waitBeforeRetry(attemptError, nextAttemptIndex, signal);
            const retried = await this.stateCommit.retryModelStep({
              scope,
              runId: snapshot.id,
              runtimeId,
              stepId: begun.stepId,
              attemptId: currentAttemptId,
              expectedRunVersion: currentRun.version,
              reservedTokens: contextPlan.estimatedInputTokens + contextPlan.reservedOutputTokens,
              usage: usageAfterFailed,
              inputTokens: failedUsage.inputTokens,
              outputTokens: failedUsage.outputTokens,
              cachedInputTokens: failedUsage.cachedInputTokens,
              estimatedUsage: usage === undefined,
              errorCode: errorCode(attemptError),
              now: this.clock.nowUnixSeconds(),
            });
            currentRun = retried.run;
            currentAttemptId = retried.attemptId;
            currentAttemptIndex = retried.attemptIndex;
            routeAttemptIndex += 1;
            yield { type: 'durable', runId: snapshot.id, cursor: retried.eventCursor };
            continue;
          }

          const nextRoute = this.modelSteps.shouldFailover(attemptError, signal)
            ? frozenRoutes[routeIndex + 1]
            : undefined;
          if (!nextRoute) throw attemptError;
          const nextPrepared = await this.modelSteps.prepare(
            snapshot,
            scope,
            offeredTools,
            inputProjections,
            collaborationContext,
            { model: nextRoute.model, capabilities: nextRoute.modelCapabilities },
            runtimeId,
          );
          const changed = await this.stateCommit.changeModelRoute({
            scope,
            runId: snapshot.id,
            runtimeId,
            stepId: begun.stepId,
            attemptId: currentAttemptId,
            expectedRunVersion: currentRun.version,
            fromModel: activeRoute.model,
            toModel: nextRoute.model,
            toRouteIndex: routeIndex + 1,
            reservedTokens: nextPrepared.contextPlan.estimatedInputTokens + nextPrepared.contextPlan.reservedOutputTokens,
            estimatedInputTokens: nextPrepared.contextPlan.estimatedInputTokens,
            heuristicInputTokens: nextPrepared.contextPlan.heuristicInputTokens,
            contextSource: nextPrepared.contextPlan.estimationSource,
            reservedOutputTokens: nextPrepared.contextPlan.reservedOutputTokens,
            contextWindowTokens: nextPrepared.model.contextWindow,
            contextEpoch: nextPrepared.contextPlan.contextEpoch,
            usage: usageAfterFailed,
            inputTokens: failedUsage.inputTokens,
            outputTokens: failedUsage.outputTokens,
            cachedInputTokens: failedUsage.cachedInputTokens,
            estimatedUsage: usage === undefined,
            errorCode: errorCode(attemptError),
            now: this.clock.nowUnixSeconds(),
          });
          currentRun = changed.run;
          currentAttemptId = changed.attemptId;
          currentAttemptIndex = changed.attemptIndex;
          routeAttemptIndex = 1;
          routeIndex += 1;
          activeRoute = nextRoute;
          preparedModelStep = nextPrepared;
          model = nextPrepared.model;
          contextPlan = nextPrepared.contextPlan;
          yield { type: 'durable', runId: snapshot.id, cursor: changed.eventCursor };
        }

        const settledUsage: TokenUsage =
          usage ??
          ({
            inputTokens: contextPlan.estimatedInputTokens,
            outputTokens: estimateTokens(text),
            cachedInputTokens: 0,
          } satisfies TokenUsage);
        const afterModelUsage = usageWithModel(currentRun.usage, settledUsage);
        const finishDisposition = modelFinishDisposition(finishReason, modelToolCalls.size);
        if (finishDisposition.kind === 'failed') throw new Error(finishDisposition.errorCode);

        if (finishDisposition.kind === 'complete') {
          if (finishReason === null) throw new Error('MODEL_FINISH_REASON_MISSING');
          const activeChildren = (await this.delegations.listDelegations(scope, snapshot.id, runtimeId, 100)).filter(
            (delegation) => !['completed', 'failed', 'cancelled'].includes(delegation.status),
          );
          if (activeChildren.length > 0) {
            const parked = await this.stateCommit.parkModelStep({
              scope,
              runId: snapshot.id,
              runtimeId,
              stepId: begun.stepId,
              attemptId: currentAttemptId,
              expectedRunVersion: currentRun.version,
              assistantEntryId: randomUUID(),
              assistantText: text,
              usage: afterModelUsage,
              inputTokens: settledUsage.inputTokens,
              outputTokens: settledUsage.outputTokens,
              cachedInputTokens: settledUsage.cachedInputTokens,
              estimatedUsage: usage === undefined,
              finishReason,
              ...(providerContinuation ? { providerContinuation } : {}),
              reason: 'waiting_subagents',
              now: this.clock.nowUnixSeconds(),
            });
            yield { type: 'durable', runId: snapshot.id, cursor: parked.eventCursor };
            yield { type: 'settled', run: parked.run };
            return;
          }
          const completionEvidence = await this.repository.completionEvidence(scope, snapshot.id);
          const gate = completionGateDecision(
            snapshot,
            completionEvidence,
            [snapshot.goal.text ?? '', latestRunInputText(snapshot)].filter(Boolean).join('\n'),
          );
          if (gate.kind === 'continue') {
            const continued = await this.stateCommit.continueModelStepForCompletionGate({
              scope,
              runId: snapshot.id,
              runtimeId,
              stepId: begun.stepId,
              attemptId: currentAttemptId,
              expectedRunVersion: currentRun.version,
              assistantEntryId: randomUUID(),
              assistantText: text,
              noticeEntryId: randomUUID(),
              notice: gate.notice,
              reasonCode: gate.reasonCode,
              inputTokens: settledUsage.inputTokens,
              outputTokens: settledUsage.outputTokens,
              cachedInputTokens: settledUsage.cachedInputTokens,
              estimatedUsage: usage === undefined,
              finishReason,
              ...(providerContinuation ? { providerContinuation } : {}),
              now: this.clock.nowUnixSeconds(),
            });
            modelStepClosed = true;
            yield { type: 'durable', runId: snapshot.id, cursor: continued.eventCursor };
            continue;
          }
          if (gate.kind === 'failed') throw new Error(gate.errorCode);
          const settled = await this.stateCommit.settleModelStep({
            scope,
            runId: snapshot.id,
            runtimeId,
            stepId: begun.stepId,
            attemptId: currentAttemptId,
            expectedRunVersion: currentRun.version,
            assistantEntryId: randomUUID(),
            assistantText: text,
            usage: afterModelUsage,
            inputTokens: settledUsage.inputTokens,
            outputTokens: settledUsage.outputTokens,
            cachedInputTokens: settledUsage.cachedInputTokens,
            estimatedUsage: usage === undefined,
            finishReason,
            ...(providerContinuation ? { providerContinuation } : {}),
            verificationSummary: gate.summary,
            terminalStatus: gate.terminalStatus,
            now: this.clock.nowUnixSeconds(),
          });
          logger.info(
            {
              runId: snapshot.id,
              threadId: snapshot.threadId,
              status: settled.run.status,
              runVersion: settled.run.version,
              eventCursor: settled.eventCursor,
              finishReason,
              inputTokens: settledUsage.inputTokens,
              outputTokens: settledUsage.outputTokens,
              cachedInputTokens: settledUsage.cachedInputTokens,
              totalSteps: settled.run.usage.steps,
            },
            'Agent run settled after model response',
          );
          yield { type: 'durable', runId: snapshot.id, cursor: settled.eventCursor };
          yield { type: 'settled', run: settled.run };
          return;
        }

        if (finishDisposition.kind !== 'tool_calls') throw new Error('MODEL_FINISH_REASON_MISMATCH');
        if (toolMode === 'none') throw new Error('MODEL_TOOL_CALL_UNEXPECTED');
        const orderedToolCalls = [...modelToolCalls.entries()].sort(([left], [right]) => left - right);
        if (orderedToolCalls.length > MAX_TOOL_CALLS_PER_MODEL_STEP) throw new Error('MODEL_TOOL_CALL_BATCH_TOO_LARGE');
        const inspectionContext = this.toolContext(currentRun, runtimeId, begun.stepId, signal);
        const batchItems = [];
        for (const [batchIndex, call] of orderedToolCalls) {
          if (!call?.id || !call.name) throw new Error('MODEL_TOOL_CALL_INVALID');
          const modelProposal: ToolProposal = {
            providerCallId: call.id,
            name: call.name,
            argumentsJson: call.argumentsJson || '{}',
          };
          try {
            const { inspection, policyDecision, proposal } = await this.toolCalls.inspect(
              inspectionContext,
              modelProposal,
              executionMode,
            );
            logger.info(
              {
                runId: snapshot.id,
                threadId: snapshot.threadId,
                stepId: begun.stepId,
                batchIndex,
                modelToolName: modelProposal.name,
                toolName: proposal.name,
                toolVersion: inspection.toolVersion,
                policyAction: policyDecision.action,
                resourceKeyCount: inspection.resourceKeys.length,
              },
              'Agent tool call inspected for model batch',
            );
            batchItems.push({
              providerCallId: proposal.providerCallId,
              toolCallId: randomUUID(),
              toolName: proposal.name,
              toolVersion: inspection.toolVersion,
              argumentsJson: proposal.argumentsJson,
              ...(proposal.name === modelProposal.name && proposal.argumentsJson === modelProposal.argumentsJson
                ? {}
                : {
                    modelToolName: modelProposal.name,
                    modelArgumentsJson: modelProposal.argumentsJson,
                  }),
              inspection,
            });
          } catch (error) {
            const code = errorCode(error);
            logger.warn(
              {
                runId: snapshot.id,
                threadId: snapshot.threadId,
                stepId: begun.stepId,
                batchIndex,
                toolName: modelProposal.name,
                errorCode: code,
              },
              'Agent tool call rejected during batch inspection',
            );
            if (code === 'TOOL_NOT_FOUND') throw error;
            batchItems.push({
              providerCallId: modelProposal.providerCallId,
              toolCallId: randomUUID(),
              toolName: modelProposal.name,
              toolVersion: 'unavailable',
              argumentsJson: modelProposal.argumentsJson,
              inspection: rejectedToolInspection(currentRun, modelProposal, code),
            });
          }
        }
        const proposed = await this.stateCommit.commitToolProposalBatch({
          scope,
          runId: snapshot.id,
          runtimeId,
          modelStepId: begun.stepId,
          attemptId: currentAttemptId,
          expectedRunVersion: currentRun.version,
          assistantEntryId: randomUUID(),
          assistantText: text,
          items: batchItems,
          usage: afterModelUsage,
          inputTokens: settledUsage.inputTokens,
          outputTokens: settledUsage.outputTokens,
          cachedInputTokens: settledUsage.cachedInputTokens,
          estimatedUsage: usage === undefined,
          finishReason,
          ...(providerContinuation ? { providerContinuation } : {}),
          now: this.clock.nowUnixSeconds(),
        });
        modelStepClosed = true;
        logger.info(
          {
            runId: snapshot.id,
            threadId: snapshot.threadId,
            stepId: begun.stepId,
            toolCallCount: proposed.items.length,
          },
          'Agent tool-call batch committed',
        );
        yield { type: 'durable', runId: snapshot.id, cursor: proposed.eventCursor };
        continue;
      } catch (error) {
        logger.warn(
          {
            runId: snapshot.id,
            threadId: snapshot.threadId,
            stepId: begun.stepId,
            attemptId: currentAttemptId,
            attemptIndex: currentAttemptIndex,
            modelStepClosed,
            aborted: signal.aborted,
            abortReason: signalReason(signal),
            errorCode: errorCode(error),
            err: error,
          },
          'Agent model/tool step failed or was interrupted',
        );
        const abortReason = signalReason(signal);
        if ((abortReason === 'NEW_INPUT' || abortReason === 'GOAL_UPDATED') && !modelStepClosed) {
          const supersededUsage: TokenUsage =
            usage ??
            ({
              inputTokens: contextPlan.estimatedInputTokens,
              outputTokens: estimateTokens(text),
              cachedInputTokens: 0,
            } satisfies TokenUsage);
          const superseded = await this.stateCommit.supersedeModelStep({
            scope,
            runId: snapshot.id,
            runtimeId,
            stepId: begun.stepId,
            attemptId: currentAttemptId,
            expectedInputRevision: snapshot.inputRevision,
            expectedGoalRevision: snapshot.goal.revision,
            reason: abortReason === 'GOAL_UPDATED' ? 'goal_updated' : 'new_input',
            usage: usageWithModel(currentRun.usage, supersededUsage),
            inputTokens: supersededUsage.inputTokens,
            outputTokens: supersededUsage.outputTokens,
            cachedInputTokens: supersededUsage.cachedInputTokens,
            estimatedUsage: usage === undefined,
            now: this.clock.nowUnixSeconds(),
          });
          yield { type: 'durable', runId: snapshot.id, cursor: superseded.eventCursor };
          return;
        }
        const cancelled = signal.aborted;
        if (modelStepClosed) {
          const latest = await this.repository.snapshot(scope, snapshot.id);
          if (!latest) throw new Error('NOT_FOUND');
          if (['completed', 'completed_unverified', 'failed', 'cancelled', 'interrupted'].includes(latest.status)) {
            yield { type: 'settled', run: latest };
            return;
          }
          const terminal = cancelled
            ? await this.cancelAtSafeBoundary(latest)
            : await this.failAtSafeBoundary(latest, errorCode(error));
          yield { type: 'durable', runId: snapshot.id, cursor: terminal.eventCursor };
          yield { type: 'settled', run: terminal.run };
          return;
        }
        const failedUsage: TokenUsage =
          usage ??
          ({
            inputTokens: contextPlan.estimatedInputTokens,
            outputTokens: text ? estimateTokens(text) : 0,
            cachedInputTokens: 0,
          } satisfies TokenUsage);
        const settled = await this.stateCommit.settleModelStep({
          scope,
          runId: snapshot.id,
          runtimeId,
          stepId: begun.stepId,
          attemptId: currentAttemptId,
          expectedRunVersion: currentRun.version,
          usage: usageWithModel(currentRun.usage, failedUsage),
          inputTokens: failedUsage.inputTokens,
          outputTokens: failedUsage.outputTokens,
          cachedInputTokens: failedUsage.cachedInputTokens,
          estimatedUsage: usage === undefined,
          ...(text
            ? {
                assistantEntryId: randomUUID(),
                assistantText: text,
              }
            : {}),
          finishReason,
          errorCode: cancelled ? 'CANCELLED' : errorCode(error),
          terminalStatus: cancelled ? 'cancelled' : 'failed',
          now: this.clock.nowUnixSeconds(),
        });
        yield { type: 'durable', runId: snapshot.id, cursor: settled.eventCursor };
        yield { type: 'settled', run: settled.run };
        return;
      }
    }
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
        this.toolContext(currentRun, pending.runtimeId, pending.stepId, signal),
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
    if ((snapshot.definition.approvalMode ?? 'ask') !== 'full_access') {
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
        let lease: Awaited<ReturnType<ToolCallRunner['acquireRead']>> | null = null;
        let result: ToolResult;
        try {
          lease = await this.toolCalls.acquireRead(
            this.toolContext(begun.run, pending.runtimeId, pending.stepId, signal),
            inspection,
            readLeaseTtlSeconds,
          );
          result = await this.toolCalls.executeRead(
            lease,
            this.toolContext(begun.run, pending.runtimeId, pending.stepId, lease.signal),
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
    const context = this.toolContext(snapshot, pending.runtimeId, pending.stepId, signal);
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
        this.toolContext(begun.run, pending.runtimeId, pending.stepId, mutationLease.signal),
        inspection,
      );

      if (toolResult.outcome !== 'confirmed') {
        await this.toolCalls
          .quarantineMutation(mutationLease, 'MUTATION_OUTCOME_UNKNOWN', {
            toolCallId: pending.toolCallId,
            errorCode: toolResult.errorCode ?? 'UNKNOWN',
          })
          .catch(() => undefined);
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
          .catch(() => undefined);
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

  private toolContext(run: RunView, runtimeId: string, stepId: string, signal: AbortSignal): ToolContext {
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
      connectionIds: [...run.definition.connectionIds],
      environment: run.definition.environment ?? null,
      stepId,
      signal,
      deadlineAt: this.clock.nowUnixSeconds() + run.budget.toolTimeoutSeconds,
      maxOutputBytes: run.budget.maxToolOutputBytes,
      inputRevision: run.inputRevision,
    };
  }

  private retryBudgetReason(run: RunView, usage: RunUsage): JsonValue | null {
    const activeExecutionSeconds =
      run.activeExecutionSeconds +
      (run.executingRuntimeCount > 0 && run.activeExecutionStartedAt !== null
        ? Math.max(0, this.clock.nowUnixSeconds() - run.activeExecutionStartedAt)
        : 0);
    const reason = activeExecutionSeconds >= run.budget.maxActiveExecutionSeconds ? 'active_time_limit' : null;
    if (!reason) return null;
    return {
      reason,
      retry: true,
      currentSteps: usage.steps,
      requestedSteps: usage.steps + 1,
      activeExecutionSeconds,
      maxActiveExecutionSeconds: run.budget.maxActiveExecutionSeconds,
    };
  }

  private async reserveModelBudget(
    snapshot: RunSnapshot,
  ): Promise<Awaited<ReturnType<RootExecutionCommitPort['commit']>> | null> {
    const activeSeconds =
      snapshot.activeExecutionSeconds +
      (snapshot.executingRuntimeCount > 0 && snapshot.activeExecutionStartedAt !== null
        ? Math.max(0, this.clock.nowUnixSeconds() - snapshot.activeExecutionStartedAt)
        : 0);
    const reason =
      snapshot.usage.steps >= snapshot.budget.maxRunSteps
        ? 'step_limit'
        : activeSeconds >= snapshot.budget.maxActiveExecutionSeconds
          ? 'active_time_limit'
          : null;
    if (!reason) return null;

    const now = this.clock.nowUnixSeconds();
    return this.stateCommit.commit({
      scope: { userId: snapshot.userId, appId: snapshot.appId },
      runId: snapshot.id,
      expectedRunVersion: snapshot.version,
      events: [
        {
          type: 'budget.increase_requested',
          payload: {
            reason,
            currentSteps: snapshot.usage.steps,
            requestedSteps: snapshot.usage.steps + 1,
            activeExecutionSeconds: activeSeconds,
            maxActiveExecutionSeconds: snapshot.budget.maxActiveExecutionSeconds,
          },
        },
        { type: 'run.status_changed', payload: { from: snapshot.status, to: 'awaiting_budget' } },
      ],
      runPatch: { status: 'awaiting_budget' },
      now,
    });
  }

  private async failAtSafeBoundary(
    snapshot: RunSnapshot | RunView,
    code: string,
  ): Promise<Awaited<ReturnType<RootExecutionCommitPort['commit']>>> {
    const now = this.clock.nowUnixSeconds();
    return this.stateCommit.commit({
      scope: { userId: snapshot.userId, appId: snapshot.appId },
      runId: snapshot.id,
      expectedRunVersion: snapshot.version,
      events: [
        { type: 'run.error', payload: { code } },
        { type: 'run.status_changed', payload: { from: snapshot.status, to: 'failed' } },
      ],
      runPatch: {
        status: 'failed',
        goalStatus: 'not_satisfied',
        verificationStatus: 'failed',
        completedAt: now,
      },
      now,
    });
  }

  private async cancelAtSafeBoundary(
    snapshot: RunSnapshot | RunView,
  ): Promise<Awaited<ReturnType<RootExecutionCommitPort['commit']>>> {
    const now = this.clock.nowUnixSeconds();
    return this.stateCommit.commit({
      scope: { userId: snapshot.userId, appId: snapshot.appId },
      runId: snapshot.id,
      expectedRunVersion: snapshot.version,
      events: [
        { type: 'run.cancelled', payload: { reason: 'abort_signal' } },
        { type: 'run.status_changed', payload: { from: snapshot.status, to: 'cancelled' } },
      ],
      runPatch: { status: 'cancelled', completedAt: now },
      now,
    });
  }
}
