import { randomUUID } from 'node:crypto';
import { ContextService } from '../../ai/context.service';
import type { LanguageModelPort } from '../../ai/language-model.port';
import type { ProviderModelConfig, TokenUsage } from '../../ai/model.types';
import { calculateModelCostMicros, ProviderService } from '../../ai/provider.service';
import { AGENT_DEFAULTS } from '../../agent-defaults';
import type { ClockPort, JsonValue } from '../../agent.types';
import type { LeaseMode, LeaseOwner, LeasePort, ResourceLease } from '../../capabilities/lease.port';
import { PolicyService } from '../../capabilities/policy.service';
import { ToolCatalog } from '../../capabilities/tool-catalog';
import { ToolExecutor } from '../../capabilities/tool-executor';
import type { ToolContext, ToolProposal, ToolResult } from '../../capabilities/tool.types';
import type { AgentBackendPort, BackendSignal } from './agent-backend.port';
import { ModelCallLimiter } from './model-call-limiter';
import type { PendingMutationTool, RunRepositoryPort } from '../runs/run.repository.port';
import type { SubagentRepositoryPort } from '../collaboration/subagent.repository.port';
import type { StateCommitPort } from '../runs/state-commit.port';
import type { RunSnapshot, RunUsage, RunView } from '../runs/run.types';

const MAX_ASSISTANT_BYTES = 256 * 1024;
const MAX_COLLABORATION_BYTES = 8 * 1024;

const boundedUtf8 = (value: string, maxBytes: number): string => {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let result = '';
  for (const character of value) {
    if (Buffer.byteLength(result + character, 'utf8') > maxBytes) break;
    result += character;
  }
  return result;
};

const estimateTokens = (value: string): number => Math.max(1, Math.ceil(Buffer.byteLength(value, 'utf8') / 4));

const latestInputText = (run: RunSnapshot): string => {
  for (let index = run.recentEntries.length - 1; index >= 0; index -= 1) {
    const entry = run.recentEntries[index]!;
    if (
      entry.kind !== 'user_input' ||
      !entry.payload ||
      typeof entry.payload !== 'object' ||
      Array.isArray(entry.payload)
    ) {
      continue;
    }
    const text = (entry.payload as Record<string, unknown>).text;
    if (typeof text === 'string') return text;
  }
  return '';
};

const usageWithModel = (base: RunUsage, delta: TokenUsage, costMicros: number): RunUsage => ({
  inputTokens: base.inputTokens + delta.inputTokens,
  outputTokens: base.outputTokens + delta.outputTokens,
  cachedInputTokens: base.cachedInputTokens + delta.cachedInputTokens,
  costMicros: base.costMicros + costMicros,
  steps: base.steps + 1,
  subagentMessages: base.subagentMessages,
  subagentMessageBytes: base.subagentMessageBytes,
});

const usageWithAttempt = (base: RunUsage, delta: TokenUsage, costMicros: number): RunUsage => ({
  inputTokens: base.inputTokens + delta.inputTokens,
  outputTokens: base.outputTokens + delta.outputTokens,
  cachedInputTokens: base.cachedInputTokens + delta.cachedInputTokens,
  costMicros: base.costMicros + costMicros,
  steps: base.steps,
  subagentMessages: base.subagentMessages,
  subagentMessageBytes: base.subagentMessageBytes,
});

const usageWithToolStep = (base: RunUsage): RunUsage => ({ ...base, steps: base.steps + 1 });

const errorCode = (error: unknown): string => {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'ABORTED';
    if (/^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
    const code = (error as Error & { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(code)) return code;
  }
  return 'MODEL_EXECUTION_FAILED';
};

const signalReason = (signal: AbortSignal): string | null => {
  if (!signal.aborted) return null;
  const reason = signal.reason;
  if (reason instanceof Error) return reason.message;
  return typeof reason === 'string' ? reason : 'ABORTED';
};

const retryableModelError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : '';
  const code =
    error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  return (
    /^PROVIDER_HTTP_(429|502|503|504)$/.test(message) ||
    [
      'PROVIDER_UNAVAILABLE',
      'PROVIDER_DNS_RESOLUTION_FAILED',
      'PROVIDER_HEADERS_TIMEOUT',
      'PROVIDER_IDLE_TIMEOUT',
      'PROVIDER_STREAM_TRUNCATED',
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'EAI_AGAIN',
    ].includes(message) ||
    ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code)
  );
};

const retryAfterMilliseconds = (error: unknown): number => {
  if (!error || typeof error !== 'object' || !('retryAfterMs' in error)) return 0;
  const value = (error as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(30_000, Math.ceil(value)) : 0;
};

const waitForRetry = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('ABORTED'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('ABORTED'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });

interface ToolCallAccumulator {
  id?: string;
  name?: string;
  argumentsJson: string;
}

const failedToolResult = (error: unknown): ToolResult => {
  const code = errorCode(error);
  return {
    ok: false,
    summary: `Read-only tool failed: ${code}`,
    artifactRefs: [],
    truncated: false,
    outcome: 'confirmed',
    errorCode: code,
    verification: {
      status: 'failed',
      summary: 'The read-only tool did not return a successful result.',
      evidenceRefs: [],
    },
  };
};

const unknownMutationResult = (error: unknown): ToolResult => {
  const code = errorCode(error);
  return {
    ok: false,
    summary: `Remote mutation outcome could not be confirmed: ${code}`,
    artifactRefs: [],
    truncated: false,
    outcome: 'unknown',
    errorCode: code,
    verification: {
      status: 'failed',
      summary: 'The transport did not provide enough evidence to prove whether the mutation completed.',
      evidenceRefs: [],
    },
  };
};

const modelCost = (model: ProviderModelConfig, usage: TokenUsage): number =>
  calculateModelCostMicros(model, usage.inputTokens, usage.outputTokens) ?? 0;

export class NativeAgentBackend implements AgentBackendPort {
  constructor(
    private readonly repository: RunRepositoryPort,
    private readonly subagents: SubagentRepositoryPort,
    private readonly providers: ProviderService,
    private readonly context: ContextService,
    private readonly modelPort: LanguageModelPort,
    private readonly stateCommit: StateCommitPort,
    private readonly toolCatalog: ToolCatalog,
    private readonly toolExecutor: ToolExecutor,
    private readonly leases: LeasePort,
    private readonly policy: PolicyService,
    private readonly modelCalls: ModelCallLimiter,
    private readonly clock: ClockPort,
  ) {}

  async *execute(initial: RunView, signal: AbortSignal): AsyncIterable<BackendSignal> {
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

      const pendingMutation = await this.repository.pendingMutation(scope, snapshot.id);
      if (pendingMutation) {
        yield* this.executePendingMutation(snapshot, pendingMutation, signal);
        continue;
      }

      const provider = await this.providers.get(snapshot.userId, snapshot.definition.model.providerId);
      if (!provider.enabled || provider.version !== snapshot.definition.model.configurationVersion) {
        const failed = await this.failAtSafeBoundary(snapshot, 'PROVIDER_CONFIGURATION_STALE');
        yield { type: 'durable', runId: snapshot.id, cursor: failed.eventCursor };
        yield { type: 'settled', run: failed.run };
        return;
      }
      const model = provider.models.find((candidate) => candidate.id === snapshot.definition.model.modelId);
      if (!model) {
        const failed = await this.failAtSafeBoundary(snapshot, 'MODEL_NOT_FOUND');
        yield { type: 'durable', runId: snapshot.id, cursor: failed.eventCursor };
        yield { type: 'settled', run: failed.run };
        return;
      }

      const remainingSteps = snapshot.budget.maxRunSteps - snapshot.usage.steps;
      const offeredTools = remainingSteps >= 2 ? this.toolCatalog.schemas(scope) : [];
      const directSubagents = await this.subagents.listDelegations(scope, snapshot.id, runtimeId, 50);
      const collaborationContext =
        directSubagents.length === 0
          ? undefined
          : boundedUtf8(
              JSON.stringify(
                directSubagents.map((delegation) => ({
                  delegationId: delegation.id,
                  childRuntimeId: delegation.childRuntimeId,
                  profileId: delegation.profileId,
                  modelRef: delegation.modelRef,
                  objective: delegation.objective,
                  status: delegation.status,
                  budget: delegation.budget,
                  usage: delegation.usage,
                  result: delegation.result,
                  evidenceRefs: delegation.evidenceRefs,
                  deadlineAt: delegation.deadlineAt,
                })),
              ),
              MAX_COLLABORATION_BYTES,
            );
      const contextPlan = await this.context.compose({
        scope,
        threadId: snapshot.threadId,
        currentInput: latestInputText(snapshot),
        collaborationContext,
        modelContextWindow: model.contextWindow,
        maxContextTokens: snapshot.budget.maxContextTokens,
        reservedOutputTokens: snapshot.budget.maxOutputTokens,
        maxRecallItems: snapshot.budget.maxRecallItems,
        maxRecallBytes: snapshot.budget.maxRecallBytes,
        tools: offeredTools,
      });

      const budgetWait = await this.reserveModelBudget(snapshot, model, contextPlan.estimatedInputTokens);
      if (budgetWait) {
        yield { type: 'durable', runId: snapshot.id, cursor: budgetWait.eventCursor };
        yield { type: 'settled', run: budgetWait.run };
        return;
      }

      const worstCaseTokens = contextPlan.estimatedInputTokens + snapshot.budget.maxOutputTokens;
      const begun = await this.stateCommit.beginModelStep({
        scope,
        runId: snapshot.id,
        runtimeId,
        expectedRunVersion: snapshot.version,
        inputWatermark: snapshot.inputRevision,
        reservedTokens: worstCaseTokens,
        now: this.clock.nowUnixSeconds(),
      });
      yield { type: 'durable', runId: snapshot.id, cursor: begun.run.eventCursor };

      let currentRun = begun.run;
      let currentAttemptId = begun.attemptId;
      let currentAttemptIndex = begun.attemptIndex;
      let text = '';
      let usage: TokenUsage | undefined;
      let finishReason: string | null = null;
      let modelStepClosed = false;
      const toolCalls = new Map<number, ToolCallAccumulator>();

      try {
        while (true) {
          text = '';
          usage = undefined;
          finishReason = null;
          toolCalls.clear();
          try {
            const releaseModelCall = await this.modelCalls.acquire(snapshot.userId, signal);
            try {
              for await (const event of this.modelPort.stream(
                {
                  userId: snapshot.userId,
                  providerId: snapshot.definition.model.providerId,
                  modelId: snapshot.definition.model.modelId,
                  messages: contextPlan.messages,
                  tools: contextPlan.toolSchemas,
                  maxOutputTokens: snapshot.budget.maxOutputTokens,
                },
                signal,
              )) {
                if (event.type === 'message.delta') {
                  text += event.text;
                  if (Buffer.byteLength(text, 'utf8') > MAX_ASSISTANT_BYTES) {
                    throw new Error('MODEL_RESPONSE_TOO_LARGE');
                  }
                  yield {
                    type: 'transient',
                    runId: snapshot.id,
                    eventType: 'message.delta',
                    payload: { text: event.text },
                  };
                } else if (event.type === 'tool.delta') {
                  const current = toolCalls.get(event.index) ?? { argumentsJson: '' };
                  if (event.id) current.id = event.id;
                  if (event.name) current.name = event.name;
                  if (event.argumentsDelta) current.argumentsJson += event.argumentsDelta;
                  toolCalls.set(event.index, current);
                  yield {
                    type: 'transient',
                    runId: snapshot.id,
                    eventType: 'tool.delta',
                    payload: {
                      index: event.index,
                      id: event.id ?? null,
                      name: event.name ?? null,
                      argumentsDelta: event.argumentsDelta ?? '',
                    },
                  };
                } else if (event.type === 'usage') {
                  usage = event.usage;
                } else if (event.type === 'completed') {
                  finishReason = event.finishReason;
                }
              }
            } finally {
              releaseModelCall();
            }
            break;
          } catch (attemptError) {
            if (
              signal.aborted ||
              !retryableModelError(attemptError) ||
              currentAttemptIndex > AGENT_DEFAULTS.modelRetryCount
            ) {
              throw attemptError;
            }
            const failedUsage: TokenUsage =
              usage ??
              ({
                inputTokens: contextPlan.estimatedInputTokens,
                outputTokens: text ? estimateTokens(text) : 0,
                cachedInputTokens: 0,
              } satisfies TokenUsage);
            const failedCost = modelCost(model, failedUsage);
            const usageAfterFailed = usageWithAttempt(currentRun.usage, failedUsage, failedCost);
            const nextAttemptIndex = currentAttemptIndex + 1;
            const defaultDelayMs = (nextAttemptIndex === 2 ? 1_000 : 2_000) + Math.floor(Math.random() * 251);
            const delayMs = Math.max(defaultDelayMs, retryAfterMilliseconds(attemptError));
            await waitForRetry(delayMs, signal);
            const budgetReason = this.retryBudgetReason(
              currentRun,
              model,
              contextPlan.estimatedInputTokens,
              usageAfterFailed,
            );
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
                costMicros: failedCost,
                priceVersion: model.priceVersion ?? null,
                errorCode: errorCode(attemptError),
                budgetReason,
                now: this.clock.nowUnixSeconds(),
              });
              yield { type: 'durable', runId: snapshot.id, cursor: paused.eventCursor };
              yield { type: 'settled', run: paused.run };
              return;
            }
            const retried = await this.stateCommit.retryModelStep({
              scope,
              runId: snapshot.id,
              runtimeId,
              stepId: begun.stepId,
              attemptId: currentAttemptId,
              expectedRunVersion: currentRun.version,
              reservedTokens: worstCaseTokens,
              usage: usageAfterFailed,
              inputTokens: failedUsage.inputTokens,
              outputTokens: failedUsage.outputTokens,
              cachedInputTokens: failedUsage.cachedInputTokens,
              estimatedUsage: usage === undefined,
              costMicros: failedCost,
              priceVersion: model.priceVersion ?? null,
              errorCode: errorCode(attemptError),
              now: this.clock.nowUnixSeconds(),
            });
            currentRun = retried.run;
            currentAttemptId = retried.attemptId;
            currentAttemptIndex = retried.attemptIndex;
            yield { type: 'durable', runId: snapshot.id, cursor: retried.eventCursor };
          }
        }

        const settledUsage: TokenUsage =
          usage ??
          ({
            inputTokens: contextPlan.estimatedInputTokens,
            outputTokens: estimateTokens(text),
            cachedInputTokens: 0,
          } satisfies TokenUsage);
        const afterModelUsage = usageWithModel(currentRun.usage, settledUsage, modelCost(model, settledUsage));

        if (toolCalls.size === 0) {
          const activeChildren = (await this.subagents.listDelegations(scope, snapshot.id, runtimeId, 100)).filter(
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
              costMicros: modelCost(model, settledUsage),
              priceVersion: model.priceVersion ?? null,
              finishReason,
              reason: 'waiting_subagents',
              now: this.clock.nowUnixSeconds(),
            });
            yield { type: 'durable', runId: snapshot.id, cursor: parked.eventCursor };
            yield { type: 'settled', run: parked.run };
            return;
          }
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
            costMicros: modelCost(model, settledUsage),
            priceVersion: model.priceVersion ?? null,
            finishReason,
            terminalStatus: 'completed_unverified',
            now: this.clock.nowUnixSeconds(),
          });
          yield { type: 'durable', runId: snapshot.id, cursor: settled.eventCursor };
          yield { type: 'settled', run: settled.run };
          return;
        }

        if (offeredTools.length === 0) throw new Error('MODEL_TOOL_CALL_UNEXPECTED');
        if (toolCalls.size !== 1) throw new Error('MODEL_PARALLEL_TOOL_CALLS_UNSUPPORTED');
        const call = [...toolCalls.entries()].sort(([left], [right]) => left - right)[0]?.[1];
        if (!call?.id || !call.name) throw new Error('MODEL_TOOL_CALL_INVALID');
        const proposal: ToolProposal = {
          providerCallId: call.id,
          name: call.name,
          argumentsJson: call.argumentsJson || '{}',
        };
        const inspectionContext = this.toolContext(currentRun, runtimeId, begun.stepId, signal);
        const inspection = await this.toolExecutor.inspect(inspectionContext, proposal);
        const policyDecision = this.policy.decide(inspection, inspection.policyRevision);
        if (policyDecision.action === 'deny') throw new Error(policyDecision.reason);
        const toolCallId = randomUUID();
        const proposed = await this.stateCommit.commitToolProposal({
          scope,
          runId: snapshot.id,
          runtimeId,
          modelStepId: begun.stepId,
          attemptId: currentAttemptId,
          expectedRunVersion: currentRun.version,
          providerCallId: proposal.providerCallId,
          toolCallId,
          toolName: proposal.name,
          toolVersion: inspection.toolVersion,
          argumentsJson: proposal.argumentsJson,
          assistantEntryId: randomUUID(),
          assistantText: text,
          inspection,
          usage: afterModelUsage,
          inputTokens: settledUsage.inputTokens,
          outputTokens: settledUsage.outputTokens,
          cachedInputTokens: settledUsage.cachedInputTokens,
          estimatedUsage: usage === undefined,
          costMicros: modelCost(model, settledUsage),
          priceVersion: model.priceVersion ?? null,
          finishReason,
          now: this.clock.nowUnixSeconds(),
        });
        modelStepClosed = true;
        yield { type: 'durable', runId: snapshot.id, cursor: proposed.eventCursor };

        if (policyDecision.action === 'requireApproval') {
          const requested = await this.stateCommit.requestToolApproval({
            scope,
            runId: proposed.run.id,
            runtimeId,
            toolStepId: proposed.toolStepId,
            toolCallId: proposed.toolCallId,
            approvalId: randomUUID(),
            expectedRunVersion: proposed.run.version,
            inspection,
            expiresAt: this.clock.nowUnixSeconds() + 600,
            now: this.clock.nowUnixSeconds(),
          });
          yield { type: 'durable', runId: snapshot.id, cursor: requested.eventCursor };
          yield { type: 'settled', run: requested.run };
          return;
        }

        const readOwner: LeaseOwner = { type: 'agent', id: runtimeId };
        const readContext = this.toolContext(proposed.run, runtimeId, proposed.toolStepId, signal);
        const readLeaseTtlSeconds = Math.min(300, Math.max(30, proposed.run.budget.toolTimeoutSeconds + 15));
        const readLeases = await this.acquireLeasesWithRetry(
          readOwner,
          inspection.resourceKeys,
          'read',
          readLeaseTtlSeconds,
          signal,
          readContext.deadlineAt,
        );
        const readLeaseIds = readLeases.map((lease) => lease.id);
        const readRenewal = this.startLeaseRenewal(readLeaseIds, readOwner, readLeaseTtlSeconds, signal);
        let toolSettled: Awaited<ReturnType<StateCommitPort['settleReadTool']>>;
        let executedToolResult: ToolResult | null = null;
        try {
          const started = await this.stateCommit.beginReadTool({
            scope,
            runId: proposed.run.id,
            runtimeId,
            toolStepId: proposed.toolStepId,
            toolCallId: proposed.toolCallId,
            expectedRunVersion: proposed.run.version,
            now: this.clock.nowUnixSeconds(),
          });
          yield { type: 'durable', runId: snapshot.id, cursor: started.eventCursor };

          let toolResult: ToolResult;
          try {
            toolResult = await this.toolExecutor.execute(
              this.toolContext(started.run, runtimeId, proposed.toolStepId, readRenewal.signal),
              inspection,
            );
          } catch (error) {
            toolResult = failedToolResult(error);
          }
          const renewalError = await readRenewal.stop();
          if (renewalError) toolResult = failedToolResult(renewalError);
          executedToolResult = toolResult;

          toolSettled = await this.stateCommit.settleReadTool({
            scope,
            runId: started.run.id,
            runtimeId,
            toolStepId: proposed.toolStepId,
            toolCallId: proposed.toolCallId,
            expectedRunVersion: started.run.version,
            toolResultEntryId: randomUUID(),
            providerCallId: proposal.providerCallId,
            result: toolResult,
            usage: usageWithToolStep(started.run.usage),
            now: this.clock.nowUnixSeconds(),
          });
          yield { type: 'durable', runId: snapshot.id, cursor: toolSettled.eventCursor };
        } finally {
          await readRenewal.stop().catch(() => undefined);
          await this.leases.release(readLeaseIds, readOwner).catch(() => undefined);
        }

        if (['cancelled', 'interrupted', 'failed'].includes(toolSettled.run.status)) {
          yield { type: 'settled', run: toolSettled.run };
          return;
        }
        if (
          inspection.toolName === 'send_agent_message' &&
          (executedToolResult?.errorCode === 'MAILBOX_BUDGET_EXCEEDED' ||
            executedToolResult?.errorCode === 'MAILBOX_HARD_LIMIT_EXCEEDED')
        ) {
          const mailboxError = executedToolResult.errorCode;
          const paused = await this.stateCommit.pauseRuntimeForBudget({
            scope,
            runId: toolSettled.run.id,
            runtimeId,
            expectedRunVersion: toolSettled.run.version,
            budgetReason: {
              scope: 'mailbox',
              canIncrease: mailboxError === 'MAILBOX_BUDGET_EXCEEDED',
              errorCode: mailboxError,
              messages: toolSettled.run.usage.subagentMessages,
              bytes: toolSettled.run.usage.subagentMessageBytes,
              maxMessages: toolSettled.run.budget.maxSubagentMessages,
              maxBytes: toolSettled.run.budget.maxSubagentMessageBytes,
            },
            now: this.clock.nowUnixSeconds(),
          });
          yield { type: 'durable', runId: snapshot.id, cursor: paused.eventCursor };
          yield { type: 'settled', run: paused.run };
          return;
        }
        if (
          inspection.toolName === 'join_subagents' &&
          executedToolResult?.ok &&
          executedToolResult.data &&
          typeof executedToolResult.data === 'object' &&
          !Array.isArray(executedToolResult.data) &&
          executedToolResult.data.ready === false
        ) {
          const parked = await this.stateCommit.parkRuntime({
            scope,
            runId: toolSettled.run.id,
            runtimeId,
            expectedRunVersion: toolSettled.run.version,
            reason: 'waiting_subagents',
            now: this.clock.nowUnixSeconds(),
          });
          yield { type: 'durable', runId: snapshot.id, cursor: parked.eventCursor };
          yield { type: 'settled', run: parked.run };
          return;
        }
        if (signal.aborted) {
          const cancelled = await this.cancelAtSafeBoundary(toolSettled.run);
          yield { type: 'durable', runId: snapshot.id, cursor: cancelled.eventCursor };
          yield { type: 'settled', run: cancelled.run };
          return;
        }
      } catch (error) {
        const abortReason = signalReason(signal);
        if (abortReason === 'NEW_INPUT' && !modelStepClosed) {
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
            usage: usageWithModel(currentRun.usage, supersededUsage, modelCost(model, supersededUsage)),
            inputTokens: supersededUsage.inputTokens,
            outputTokens: supersededUsage.outputTokens,
            cachedInputTokens: supersededUsage.cachedInputTokens,
            estimatedUsage: usage === undefined,
            costMicros: modelCost(model, supersededUsage),
            priceVersion: model.priceVersion ?? null,
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
        const failedCost = modelCost(model, failedUsage);
        const settled = await this.stateCommit.settleModelStep({
          scope,
          runId: snapshot.id,
          runtimeId,
          stepId: begun.stepId,
          attemptId: currentAttemptId,
          expectedRunVersion: currentRun.version,
          usage: usageWithModel(currentRun.usage, failedUsage, failedCost),
          inputTokens: failedUsage.inputTokens,
          outputTokens: failedUsage.outputTokens,
          cachedInputTokens: failedUsage.cachedInputTokens,
          estimatedUsage: usage === undefined,
          costMicros: failedCost,
          priceVersion: model.priceVersion ?? null,
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

  private async acquireLeasesWithRetry(
    owner: LeaseOwner,
    resourceKeys: readonly string[],
    mode: LeaseMode,
    ttlSeconds: number,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<ResourceLease[]> {
    while (true) {
      if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
      if (this.clock.nowUnixSeconds() >= deadlineAt) throw new Error('TOOL_TIMEOUT');
      try {
        return await this.leases.acquireMany(owner, resourceKeys, mode, ttlSeconds);
      } catch (error) {
        if (errorCode(error) !== 'LEASE_CONFLICT') throw error;
        await waitForRetry(Math.min(500, Math.max(50, deadlineAt * 1000 - Date.now())), signal);
      }
    }
  }

  private startLeaseRenewal(
    leaseIds: readonly string[],
    owner: LeaseOwner,
    ttlSeconds: number,
    parentSignal: AbortSignal,
  ): { signal: AbortSignal; stop: () => Promise<unknown | null> } {
    const controller = new AbortController();
    let stopped = false;
    let renewalError: unknown | null = null;
    let tail = Promise.resolve();
    const abortFromParent = (): void => {
      if (!controller.signal.aborted) controller.abort(parentSignal.reason ?? new Error('ABORTED'));
    };
    if (parentSignal.aborted) abortFromParent();
    else parentSignal.addEventListener('abort', abortFromParent, { once: true });
    const renew = (): void => {
      tail = tail.then(async () => {
        if (stopped || controller.signal.aborted) return;
        try {
          await this.leases.renew(leaseIds, owner, ttlSeconds);
        } catch (error) {
          renewalError = error;
          controller.abort(error);
        }
      });
    };
    const timer = setInterval(renew, 10_000);
    timer.unref?.();
    return {
      signal: controller.signal,
      stop: async () => {
        if (!stopped) {
          stopped = true;
          clearInterval(timer);
          parentSignal.removeEventListener('abort', abortFromParent);
        }
        await tail.catch(() => undefined);
        return renewalError;
      },
    };
  }

  private async *executePendingMutation(
    snapshot: RunSnapshot,
    pending: PendingMutationTool,
    signal: AbortSignal,
  ): AsyncIterable<BackendSignal> {
    const scope = { userId: snapshot.userId, appId: snapshot.appId };
    const owner = { type: 'agent' as const, id: pending.runtimeId };
    const context = this.toolContext(snapshot, pending.runtimeId, pending.stepId, signal);
    let inspection;
    try {
      inspection = await this.toolExecutor.refreshInspection(context, pending.inspection);
    } catch (error) {
      const superseded = await this.stateCommit.supersedeMutationTool({
        scope,
        runId: snapshot.id,
        toolStepId: pending.stepId,
        toolCallId: pending.toolCallId,
        approvalId: pending.approvalId,
        expectedRunVersion: snapshot.version,
        reason: `Approved operation could not be re-inspected safely: ${errorCode(error)}`,
        now: this.clock.nowUnixSeconds(),
      });
      yield { type: 'durable', runId: snapshot.id, cursor: superseded.eventCursor };
      return;
    }
    const decision = this.policy.decide(inspection, inspection.policyRevision);
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
        approvalId: pending.approvalId,
        expectedRunVersion: snapshot.version,
        reason: 'The target, preconditions, input, or policy changed after approval.',
        now: this.clock.nowUnixSeconds(),
      });
      yield { type: 'durable', runId: snapshot.id, cursor: superseded.eventCursor };
      return;
    }

    const leaseTtlSeconds = Math.min(300, Math.max(30, snapshot.budget.toolTimeoutSeconds + 15));
    let acquired: ResourceLease[];
    try {
      acquired = await this.acquireLeasesWithRetry(
        owner,
        inspection.resourceKeys,
        'write',
        leaseTtlSeconds,
        signal,
        context.deadlineAt,
      );
    } catch (error) {
      const code = errorCode(error);
      const superseded = await this.stateCommit.supersedeMutationTool({
        scope,
        runId: snapshot.id,
        toolStepId: pending.stepId,
        toolCallId: pending.toolCallId,
        approvalId: pending.approvalId,
        expectedRunVersion: snapshot.version,
        reason: `Approved operation cannot acquire its resource lease: ${code}`,
        now: this.clock.nowUnixSeconds(),
      });
      yield { type: 'durable', runId: snapshot.id, cursor: superseded.eventCursor };
      return;
    }
    const leaseIds = acquired.map((lease) => lease.id);
    const renewal = this.startLeaseRenewal(leaseIds, owner, leaseTtlSeconds, signal);
    let mutationStarted = false;
    try {
      const begun = await this.stateCommit.beginMutationTool({
        scope,
        runId: snapshot.id,
        runtimeId: pending.runtimeId,
        toolStepId: pending.stepId,
        toolCallId: pending.toolCallId,
        approvalId: pending.approvalId,
        expectedRunVersion: snapshot.version,
        operationHash: inspection.operationHash,
        expectedPolicyRevision: inspection.policyRevision,
        expectedInputRevision: inspection.inputRevision,
        now: this.clock.nowUnixSeconds(),
      });
      yield { type: 'durable', runId: snapshot.id, cursor: begun.eventCursor };
      await this.leases.markMutationActive(leaseIds, owner, pending.toolCallId);
      mutationStarted = true;

      let toolResult: ToolResult;
      try {
        toolResult = await this.toolExecutor.executeMutation(
          this.toolContext(begun.run, pending.runtimeId, pending.stepId, renewal.signal),
          inspection,
        );
      } catch (error) {
        toolResult = unknownMutationResult(error);
      }
      const renewalError = await renewal.stop();
      if (renewalError) toolResult = unknownMutationResult(renewalError);

      if (toolResult.outcome !== 'confirmed') {
        await this.leases
          .quarantine(
            owner,
            inspection.resourceKeys,
            'MUTATION_OUTCOME_UNKNOWN',
            { toolCallId: pending.toolCallId, errorCode: toolResult.errorCode ?? 'UNKNOWN' },
            pending.toolCallId,
          )
          .catch(() => undefined);
      }

      let settled: Awaited<ReturnType<StateCommitPort['settleMutationTool']>>;
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
        await this.leases
          .quarantine(
            owner,
            inspection.resourceKeys,
            'STATE_COMMIT_FAILED_AFTER_MUTATION',
            { toolCallId: pending.toolCallId, errorCode: errorCode(error) },
            pending.toolCallId,
          )
          .catch(() => undefined);
        throw error;
      }

      if (toolResult.outcome === 'confirmed') {
        try {
          await this.leases.markMutationSettled(leaseIds, owner, pending.toolCallId);
          mutationStarted = false;
          await this.leases.release(leaseIds, owner);
        } catch (error) {
          await this.leases
            .quarantine(
              owner,
              inspection.resourceKeys,
              'LEASE_STATE_UNCERTAIN_AFTER_MUTATION',
              { toolCallId: pending.toolCallId, errorCode: errorCode(error) },
              pending.toolCallId,
            )
            .catch(() => undefined);
        }
      }

      yield { type: 'durable', runId: snapshot.id, cursor: settled.eventCursor };
      if (settled.run.status === 'interrupted') yield { type: 'settled', run: settled.run };
    } finally {
      await renewal.stop().catch(() => undefined);
      if (!mutationStarted) {
        await this.leases.release(leaseIds, owner).catch(() => undefined);
      }
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
      stepId,
      signal,
      deadlineAt: this.clock.nowUnixSeconds() + run.budget.toolTimeoutSeconds,
      maxOutputBytes: run.budget.maxToolOutputBytes,
      inputRevision: run.inputRevision,
    };
  }

  private retryBudgetReason(
    run: RunView,
    model: ProviderModelConfig,
    estimatedInputTokens: number,
    usage: RunUsage,
  ): JsonValue | null {
    const requestedTokens = estimatedInputTokens + run.budget.maxOutputTokens;
    const remainingTokens = Math.max(0, run.budget.maxRunTokens - usage.inputTokens - usage.outputTokens);
    const requestedCostMicros = calculateModelCostMicros(model, estimatedInputTokens, run.budget.maxOutputTokens);
    const remainingCostMicros =
      run.budget.maxRunCostMicros === null ? null : Math.max(0, run.budget.maxRunCostMicros - usage.costMicros);
    const activeExecutionSeconds =
      run.activeExecutionSeconds +
      (run.executingRuntimeCount > 0 && run.activeExecutionStartedAt !== null
        ? Math.max(0, this.clock.nowUnixSeconds() - run.activeExecutionStartedAt)
        : 0);
    const reason =
      requestedTokens > remainingTokens
        ? 'token_limit'
        : remainingCostMicros !== null && (requestedCostMicros === null || requestedCostMicros > remainingCostMicros)
          ? 'cost_limit'
          : activeExecutionSeconds >= run.budget.maxActiveExecutionSeconds
            ? 'active_time_limit'
            : null;
    if (!reason) return null;
    return {
      reason,
      retry: true,
      currentSteps: usage.steps,
      requestedSteps: usage.steps + 1,
      remainingTokens,
      requestedTokens,
      remainingCostMicros,
      requestedCostMicros,
      activeExecutionSeconds,
      maxActiveExecutionSeconds: run.budget.maxActiveExecutionSeconds,
    };
  }

  private async reserveModelBudget(
    snapshot: RunSnapshot,
    model: ProviderModelConfig,
    estimatedInputTokens: number,
  ): Promise<Awaited<ReturnType<StateCommitPort['commit']>> | null> {
    const worstCaseTokens = estimatedInputTokens + snapshot.budget.maxOutputTokens;
    const remainingTokens = Math.max(
      0,
      snapshot.budget.maxRunTokens - snapshot.usage.inputTokens - snapshot.usage.outputTokens,
    );
    const worstCaseCost = calculateModelCostMicros(model, estimatedInputTokens, snapshot.budget.maxOutputTokens);
    const remainingCost =
      snapshot.budget.maxRunCostMicros === null
        ? null
        : Math.max(0, snapshot.budget.maxRunCostMicros - snapshot.usage.costMicros);
    const activeSeconds =
      snapshot.activeExecutionSeconds +
      (snapshot.executingRuntimeCount > 0 && snapshot.activeExecutionStartedAt !== null
        ? Math.max(0, this.clock.nowUnixSeconds() - snapshot.activeExecutionStartedAt)
        : 0);
    const reason =
      snapshot.usage.steps >= snapshot.budget.maxRunSteps
        ? 'step_limit'
        : worstCaseTokens > remainingTokens
          ? 'token_limit'
          : remainingCost !== null && (worstCaseCost === null || worstCaseCost > remainingCost)
            ? 'cost_limit'
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
            remainingTokens,
            requestedTokens: worstCaseTokens,
            remainingCostMicros: remainingCost,
            requestedCostMicros: worstCaseCost,
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
  ): Promise<Awaited<ReturnType<StateCommitPort['commit']>>> {
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
  ): Promise<Awaited<ReturnType<StateCommitPort['commit']>>> {
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
