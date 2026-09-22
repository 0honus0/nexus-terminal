import { randomUUID } from 'node:crypto';
import type { ModelFinishReason, ModelProviderContinuation, TokenUsage } from '../../ai/model.types';
import type { ClockPort, JsonValue } from '../../agent.types';
import type { ToolInspection, ToolProposal } from '../../capabilities/tool.types';
import type { AgentBackendPort, BackendSignal } from './agent-backend.port';
import { completionGateDecision } from './completion-gate';
import { executionErrorCode } from './execution-errors';
import { modelFinishDisposition } from './model-finish-policy';
import { ModelStepRunner, type ModelToolCall } from './model-step-runner';
import { estimateTokens } from './model-accounting';
import { ToolCallRunner } from './tool-call-runner';
import { RootToolExecutionCoordinator } from './root-tool-execution-coordinator';
import { rootToolContext } from './root-tool-execution-common';
import type { RunExecutionReaderPort } from '../runs/run.repository.port';
import type { DelegationReaderPort } from '../collaboration/subagent.repository.port';
import type { SubagentPolicyService } from '../collaboration/subagent-policy';
import { projectSubagentCollaborationContext } from '../collaboration/subagent-context-projection';
import type { RootExecutionCommitPort } from '../runs/state-commit.port';
import type { RunSnapshot, RunUsage, RunView } from '../runs/run.types';
import { runModelRoutes } from '../runs/model-routes';
import { requestHash } from '../runs/idempotency';
import { logErrorCode, logger } from '../../../../shared/logging/logger';

const MAX_TOOL_CALLS_PER_MODEL_STEP = 64;

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

const errorCode = (error: unknown): string => executionErrorCode(error, 'MODEL_EXECUTION_FAILED');

const signalReason = (signal: AbortSignal): string | null => {
  if (!signal.aborted) return null;
  const reason = signal.reason;
  if (reason instanceof Error) return reason.message;
  return typeof reason === 'string' ? reason : 'ABORTED';
};

export class NativeAgentBackend implements AgentBackendPort {
  private readonly rootTools: RootToolExecutionCoordinator;

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
  ) {
    this.rootTools = new RootToolExecutionCoordinator(repository, stateCommit, toolCalls, clock, recoverySafePoint);
  }

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

      const stableErrorCode = logErrorCode(error, errorCode(error));
      logger.warn(
        {
          runId: initial.id,
          threadId: initial.threadId,
          appId: initial.appId,
          userId: initial.userId,
          providerId: initial.definition.model.providerId,
          modelId: initial.definition.model.modelId,
          status: initial.status,
          aborted: signal.aborted,
          abortReason,
          errorCode: stableErrorCode,
        },
        'Agent backend execution failed at outer boundary',
      );
      const interrupted = await this.stateCommit.interruptUnexpectedRootExecution({
        scope,
        runId: initial.id,
        errorCode: stableErrorCode,
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
        const disposition = yield* this.rootTools.execute(snapshot, pendingTools, signal);
        if (disposition === 'return') return;
        continue;
      }

      await this.recoverySafePoint(snapshot, 'model_boundary');

      const remainingSteps = snapshot.budget.maxRunSteps - snapshot.usage.steps;
      const executionMode = snapshot.definition.executionMode;
      const offeredTools = this.toolCalls.schemas(
        scope,
        {
          environment: snapshot.definition.environment ?? null,
          connectionIds: snapshot.definition.connectionIds,
        },
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
            reservedTokens:
              nextPrepared.contextPlan.estimatedInputTokens + nextPrepared.contextPlan.reservedOutputTokens,
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
        const inspectionContext = rootToolContext(
          currentRun,
          runtimeId,
          begun.stepId,
          signal,
          this.clock.nowUnixSeconds(),
        );
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
            errorCode: logErrorCode(error, errorCode(error)),
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
