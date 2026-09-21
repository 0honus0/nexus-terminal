import { createHash, randomUUID } from 'node:crypto';
import { logErrorCode, logger } from '../../../../shared/logging/logger';
import type { ClockPort, Scope } from '../../agent.types';
import type { LanguageModelPort } from '../../ai/language-model.port';
import { applyModelCapabilitySnapshot } from '../../ai/model-capability-resolver';
import { modelCacheLineageKey } from '../../ai/model-cache-hint';
import type { ModelFinishReason, ModelProviderContinuation, TokenUsage } from '../../ai/model.types';
import type { ProviderService } from '../../ai/provider.service';
import type { ToolExecutor } from '../../capabilities/tool-executor';
import type { ToolContext, ToolInspection, ToolProposal, ToolResult } from '../../capabilities/tool.types';
import type { AgentEventHub } from '../events/event-hub';
import { executionErrorCode, failedToolResult as buildFailedToolResult } from '../execution/execution-errors';
import { estimateTokens } from '../execution/model-accounting';
import type { ModelCallLimiter } from '../execution/model-call-limiter';
import { modelFinishDisposition } from '../execution/model-finish-policy';
import { boundedUtf8 } from '../execution/text-budget';
import type { RunSnapshotReaderPort } from '../runs/run.repository.port';
import type { RunView } from '../runs/run.types';
import type { CollaborationCommitPort } from '../runs/state-commit.port';
import type { SubagentCompletionCoordinator } from './subagent-completion-coordinator';
import type { SubagentContextBuilder } from './subagent-context-builder';
import type {
  DelegationCancellationPort,
  MailboxConsumerPort,
  RuntimeParticipantRepositoryPort,
  SchedulerWorkExecutionPort,
} from './subagent.repository.port';
import type { DelegationView, SchedulerWorkView } from './subagent.types';

const MAX_CHILD_OUTPUT_BYTES = 64 * 1024;
const MAX_COMPLETION_BYTES = 8 * 1024;

const errorCode = (error: unknown): string => executionErrorCode(error, 'SUBAGENT_EXECUTION_FAILED');

const terminalDelegation = (value: DelegationView): boolean =>
  value.status === 'completed' || value.status === 'failed' || value.status === 'cancelled';

const failedToolResult = (error: unknown): ToolResult =>
  buildFailedToolResult(error, {
    fallbackCode: 'SUBAGENT_EXECUTION_FAILED',
    summaryPrefix: 'Subagent tool failed',
    verificationSummary: 'The subagent tool did not return a successful result.',
  });

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

export class SubagentModelStepExecutor {
  constructor(
    private readonly work: SchedulerWorkExecutionPort,
    private readonly delegations: DelegationCancellationPort,
    private readonly runtimes: RuntimeParticipantRepositoryPort,
    private readonly mailboxes: MailboxConsumerPort,
    private readonly runs: RunSnapshotReaderPort,
    private readonly providers: ProviderService,
    private readonly modelPort: LanguageModelPort,
    private readonly modelCalls: ModelCallLimiter,
    private readonly stateCommit: CollaborationCommitPort,
    private readonly contextBuilder: SubagentContextBuilder,
    private readonly toolExecutor: ToolExecutor,
    private readonly completion: SubagentCompletionCoordinator,
    private readonly events: AgentEventHub,
    private readonly clock: ClockPort,
  ) {}

  async execute(scope: Scope, work: SchedulerWorkView, ownerEpoch: number, signal: AbortSignal): Promise<void> {
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
      await this.completion.completeModelEarlyFailure(scope, work, delegation, 'DELEGATION_DEADLINE_EXCEEDED');
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
      await this.completion.completeModelEarlyFailure(scope, work, delegation, 'SUBAGENT_MODEL_INTERRUPTED');
      return;
    }

    const provider = await this.providers.get(scope.userId, delegation.modelRef.providerId);
    if (!provider.enabled || provider.version !== delegation.modelRef.configurationVersion) {
      await this.completion.failBeforeModel(scope, work, delegation, ownerEpoch, 'SUBAGENT_MODEL_UNAVAILABLE');
      return;
    }
    const configuredModel = provider.models.find((candidate) => candidate.id === delegation.modelRef.modelId);
    if (!configuredModel) {
      await this.completion.failBeforeModel(scope, work, delegation, ownerEpoch, 'SUBAGENT_MODEL_UNAVAILABLE');
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
      await this.completion.failBeforeModel(scope, work, delegation, ownerEpoch, preparedContext.code);
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
            !this.contextBuilder.allowsProposal(scope, delegation, proposal)
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
                .catch((error) =>
                  logger.warn(
                    {
                      errorCode: errorCode(error),
                      runId: work.runId,
                      workId: work.id,
                      runtimeId: work.agentRuntimeId,
                      throughSequence: through,
                    },
                    'Agent Subagent mailbox consume after tool proposal failed',
                  ),
                );
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
    const verifiedEvidence = await this.completion
      .verifiedRuntimeEvidence(scope, work.runId, work.agentRuntimeId)
      .catch(() => ({
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
        .catch((error) =>
          logger.warn(
            {
              errorCode: logErrorCode(error, 'MAILBOX_CONSUME_FAILED'),
              userId: scope.userId,
              appId: scope.appId,
              runId: work.runId,
              runtimeId: work.agentRuntimeId,
              workId: work.id,
              delegationId: delegation.id,
            },
            'Agent Subagent mailbox consumption after completion failed',
          ),
        );
    }
    await this.completion.completeModelResult(scope, work, delegation, outcome, completion, failureCode, evidenceRefs);
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
