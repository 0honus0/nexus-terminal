import { randomUUID } from 'node:crypto';
import type { ClockPort, JsonValue, Scope } from '../../agent.types';
import type { LanguageModelPort } from '../../ai/language-model.port';
import type { TokenUsage } from '../../ai/model.types';
import type { ProviderService } from '../../ai/provider.service';
import type { LeaseOwner, ResourceLease } from '../../capabilities/lease.port';
import type { ToolExecutor } from '../../capabilities/tool-executor';
import type { ToolContext, ToolProposal, ToolResult } from '../../capabilities/tool.types';
import type { AgentEventHub } from '../events/event-hub';
import { executionErrorCode, failedToolResult as buildFailedToolResult } from '../execution/execution-errors';
import { LeaseCoordinator, type LeaseRenewal } from '../execution/lease-coordinator';
import type { ModelCallLimiter } from '../execution/model-call-limiter';
import { estimateTokens, modelCost } from '../execution/model-accounting';
import { boundedUtf8 } from '../execution/text-budget';
import type { RunRepositoryPort } from '../runs/run.repository.port';
import type { RunView } from '../runs/run.types';
import type { StateCommitPort } from '../runs/state-commit.port';
import type { MailboxService } from './mailbox.service';
import type { SubagentContextBuilder } from './subagent-context-builder';
import type {
  DelegationRepositoryPort,
  MailboxRepositoryPort,
  RuntimeParticipantRepositoryPort,
  SchedulerWorkRepositoryPort,
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

interface ToolCallAccumulator {
  id?: string;
  name?: string;
  argumentsJson: string;
}

export interface SubagentExecutionHost {
  enqueueRootRun(runId: string, scope: Scope): Promise<void>;
  wakeChildScheduler(): void;
}

export class SubagentParticipantExecutor {
  constructor(
    private readonly work: SchedulerWorkRepositoryPort,
    private readonly delegations: DelegationRepositoryPort,
    private readonly runtimes: RuntimeParticipantRepositoryPort,
    private readonly mailboxes: MailboxRepositoryPort,
    private readonly runs: RunRepositoryPort,
    private readonly providers: ProviderService,
    private readonly modelPort: LanguageModelPort,
    private readonly modelCalls: ModelCallLimiter,
    private readonly stateCommit: StateCommitPort,
    private readonly contextBuilder: SubagentContextBuilder,
    private readonly toolExecutor: ToolExecutor,
    private readonly leaseCoordinator: LeaseCoordinator,
    private readonly mailbox: MailboxService,
    private readonly events: AgentEventHub,
    private readonly host: SubagentExecutionHost,
    private readonly clock: ClockPort,
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
      const leaseTtlSeconds = Math.min(300, Math.max(30, activeRun.budget.toolTimeoutSeconds + 15));
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
        costMicros: 0,
        estimatedUsage: true,
        priceVersion: null,
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
    const model = provider.models.find((candidate) => candidate.id === delegation.modelRef.modelId);
    if (!model) {
      await this.failBeforeModel(scope, work, delegation, ownerEpoch, 'SUBAGENT_MODEL_UNAVAILABLE');
      return;
    }
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
    const { runtime, inbox, messages, offeredTools, estimatedInputTokens, maxOutputTokens } = preparedContext.plan;
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
    let finishReason: string | null = null;
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
            messages,
            ...(offeredTools.length > 0 ? { tools: offeredTools } : {}),
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
              payload: { runtimeId: work.agentRuntimeId, delegationId: delegation.id, text: event.text },
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
    if (
      outcome === 'completed' &&
      delegation.usage.tokens + settledUsage.inputTokens + settledUsage.outputTokens > delegation.budget.maxTokens
    ) {
      outcome = 'failed';
      failureCode = 'DELEGATION_BUDGET_EXCEEDED';
    }
    if (outcome === 'completed' && toolCalls.size > 0) {
      if (offeredTools.length === 0 || toolCalls.size !== 1) {
        outcome = 'failed';
        failureCode = offeredTools.length === 0 ? 'SUBAGENT_TOOL_NOT_ALLOWED' : 'MODEL_PARALLEL_TOOL_CALLS_UNSUPPORTED';
      } else {
        const call = [...toolCalls.entries()].sort(([left], [right]) => left - right)[0]?.[1];
        if (!call?.id || !call.name || !offeredTools.some((tool) => tool.name === call.name)) {
          outcome = 'failed';
          failureCode = 'SUBAGENT_TOOL_NOT_ALLOWED';
        } else {
          try {
            const proposal: ToolProposal = {
              providerCallId: call.id,
              name: call.name,
              argumentsJson: call.argumentsJson || '{}',
            };
            const inspection = await this.toolExecutor.inspect(
              this.toolContext(begun.run, work.agentRuntimeId, begun.stepId, signal, delegation.deadlineAt),
              proposal,
            );
            const proposed = await this.stateCommit.commitSubagentToolProposal({
              scope,
              runId: work.runId,
              runtimeId: work.agentRuntimeId,
              delegationId: delegation.id,
              workId: work.id,
              ownerEpoch,
              modelStepId: begun.stepId,
              attemptId: begun.attemptId,
              expectedRunVersion: begun.run.version,
              providerCallId: proposal.providerCallId,
              toolCallId: randomUUID(),
              toolName: proposal.name,
              toolVersion: inspection.toolVersion,
              inspection,
              inputTokens: settledUsage.inputTokens,
              outputTokens: settledUsage.outputTokens,
              cachedInputTokens: settledUsage.cachedInputTokens,
              costMicros: modelCost(model, settledUsage),
              estimatedUsage: usage === undefined,
              priceVersion: model.priceVersion ?? null,
              finishReason,
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
          ? { summary: completion, finishReason }
          : { summary: completion, errorCode: failureCode ?? 'SUBAGENT_EXECUTION_FAILED' },
      evidenceRefs: [],
      inputTokens: settledUsage.inputTokens,
      outputTokens: settledUsage.outputTokens,
      cachedInputTokens: settledUsage.cachedInputTokens,
      costMicros: modelCost(model, settledUsage),
      estimatedUsage: usage === undefined,
      priceVersion: model.priceVersion ?? null,
      finishReason,
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
    await this.sendCompletion(scope, work.runId, delegation, outcome, completion, failureCode).catch((error) =>
      console.error(`[Agent SubagentParticipantExecutor] completion mailbox failed for ${delegation.id}:`, error),
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
        artifactRefs: delegation.evidenceRefs,
        ttlSeconds: 86_400,
      },
      delegation.id,
    );
  }

  private async cancelSiblings(scope: Scope, failed: DelegationView): Promise<void> {
    const siblings = await this.delegations.listDelegations(scope, failed.runId, failed.parentRuntimeId);
    for (const sibling of siblings) {
      if (sibling.id === failed.id || terminalDelegation(sibling)) continue;
      const descendants = await this.delegations.descendants(scope, failed.runId, sibling.childRuntimeId);
      for (const descendant of descendants) {
        if (!terminalDelegation(descendant)) {
          await this.delegations
            .cancelDelegation(scope, failed.runId, descendant.id, descendant.version, this.clock.nowUnixSeconds())
            .catch(() => undefined);
        }
      }
      await this.delegations
        .cancelDelegation(scope, failed.runId, sibling.id, sibling.version, this.clock.nowUnixSeconds())
        .catch(() => undefined);
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
