import { randomUUID } from 'node:crypto';
import { logger } from '../../../../shared/logging/logger';
import type { ClockPort, JsonValue, Scope } from '../../agent.types';
import { ProviderService } from '../../ai/provider.service';
import type { ProviderModelConfig } from '../../ai/model.types';
import { deriveAutomaticThreadTitle } from '../../ai/thread-title';
import { AgentSettingsService } from '../../host/agent-settings.service';
import { AppLifecycleService } from '../../host/app-lifecycle.service';
import type { AgentExecutionPolicyService, AgentExecutionPolicyView } from '../../host/agent-execution-policy.service';
import { isAgentUuid } from '../../uuid';
import type { AgentDefinitionRegistryPort } from '../definitions/agent-definition.port';
import type { RunQueryPort } from './run.repository.port';
import { requestHash, requireIdempotencyKey } from './idempotency';
import type { RunCommandCommitPort } from './state-commit.port';
import type {
  CreateRunCommand,
  PendingRunInputPage,
  RunBudget,
  RunBudgetIncrease,
  RunDefinitionSnapshot,
  RunSnapshot,
  RunView,
  UserInputData,
} from './run.types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validateInput = (input: UserInputData): UserInputData => {
  if (!input || typeof input.text !== 'string' || !Array.isArray(input.artifactRefs))
    throw new Error('VALIDATION_FAILED');
  if (Buffer.byteLength(input.text, 'utf8') > 32 * 1024) throw new Error('PAYLOAD_TOO_LARGE');
  if (input.artifactRefs.length > 10 || input.artifactRefs.some((id) => !isAgentUuid(id))) {
    throw new Error('VALIDATION_FAILED');
  }
  return { text: input.text, artifactRefs: [...new Set(input.artifactRefs.map((id) => id.toLowerCase()))] };
};

const normalizeGoalText = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('VALIDATION_FAILED');
  const normalized = value.trim();
  if (!normalized || Buffer.byteLength(normalized, 'utf8') > 4096) throw new Error('VALIDATION_FAILED');
  return normalized;
};

const validateConnectionIds = (values: number[]): number[] => {
  if (
    !Array.isArray(values) ||
    values.length > 50 ||
    values.some((value) => !Number.isSafeInteger(value) || value < 1)
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return [...new Set(values)];
};

const runBudgetFrom = (
  settings: Awaited<ReturnType<AgentSettingsService['get']>>,
  policy: AgentExecutionPolicyView,
  model: ProviderModelConfig,
): RunBudget => ({
  // Model context/output are physical capabilities, not Nexus user budgets.
  maxContextTokens: model.contextWindow,
  maxOutputTokens: Math.max(1, Math.min(model.maxOutputTokens, model.contextWindow - 1)),
  maxRunTokens: policy.effective.maxRunTokens,
  maxRunSteps: policy.effective.maxRunSteps,
  maxActiveExecutionSeconds: policy.effective.maxActiveExecutionSeconds,
  toolTimeoutSeconds: policy.effective.toolTimeoutSeconds,
  maxToolOutputBytes: policy.effective.maxToolOutputBytes,
  maxRawToolBytes: policy.effective.maxRawToolBytes,
  maxRecallItems: policy.effective.maxRecallItems,
  maxRecallBytes: policy.effective.maxRecallBytes,
  maxSubagentMessages: policy.effective.maxSubagentMessages,
  maxSubagentMessageBytes: policy.effective.maxSubagentMessageBytes,
  contextCompactionMode: policy.effective.contextCompactionMode,
  revision: Math.max(settings.revision, policy.version),
});

const increasedBudget = (
  current: RunBudget,
  rawIncrease: RunBudgetIncrease,
  hardLimits: Awaited<ReturnType<AgentSettingsService['get']>>['hardLimits'],
): RunBudget => {
  const raw: unknown = rawIncrease;
  if (!isRecord(raw)) throw new Error('VALIDATION_FAILED');
  const allowed = new Set([
    'maxRunTokens',
    'maxRunSteps',
    'maxActiveExecutionSeconds',
    'maxSubagentMessages',
    'maxSubagentMessageBytes',
  ]);
  if (Object.keys(raw).length === 0 || Object.keys(raw).some((key) => !allowed.has(key))) {
    throw new Error('VALIDATION_FAILED');
  }
  const next: RunBudget = { ...current };
  let changed = false;
  const raiseNumber = (
    key:
      'maxRunTokens' | 'maxRunSteps' | 'maxActiveExecutionSeconds' | 'maxSubagentMessages' | 'maxSubagentMessageBytes',
    hardLimit: number,
  ): void => {
    if (!(key in raw)) return;
    const target = raw[key];
    if (typeof target !== 'number' || !Number.isSafeInteger(target) || target < 1) {
      throw new Error('VALIDATION_FAILED');
    }
    if (target <= current[key]) throw new Error('BUDGET_INCREASE_INVALID');
    if (target > hardLimit) throw new Error('BUDGET_HARD_LIMIT_EXCEEDED');
    next[key] = target;
    changed = true;
  };
  raiseNumber('maxRunTokens', hardLimits.maxRunTokens);
  raiseNumber('maxRunSteps', hardLimits.maxRunSteps);
  raiseNumber('maxActiveExecutionSeconds', hardLimits.maxActiveExecutionSeconds);
  raiseNumber('maxSubagentMessages', hardLimits.maxSubagentMessagesPerRun);
  raiseNumber('maxSubagentMessageBytes', hardLimits.maxSubagentMessageBytesPerRun);

  if (!changed) throw new Error('BUDGET_INCREASE_INVALID');
  next.revision = current.revision + 1;
  return next;
};

export class RunService {
  constructor(
    private readonly settings: AgentSettingsService,
    private readonly lifecycle: AppLifecycleService,
    private readonly providers: ProviderService,
    private readonly executionPolicies: AgentExecutionPolicyService,
    private readonly definitions: AgentDefinitionRegistryPort,
    private readonly resolveEnvironment: (
      scope: Scope,
      selection: NonNullable<CreateRunCommand['environment']>,
      expectedSettingsRevision: number,
    ) => Promise<NonNullable<RunDefinitionSnapshot['environment']>>,
    private readonly stateCommit: RunCommandCommitPort,
    private readonly repository: RunQueryPort,
    private readonly clock: ClockPort,
    private readonly onCreated: (run: RunView) => void = () => undefined,
    private readonly onCommitted: (run: RunView) => void = () => undefined,
    private readonly onInputAppended: (run: RunView) => void = () => undefined,
    private readonly onGoalUpdated: (run: RunView) => void = () => undefined,
    private readonly onCancelRequested: (runId: string) => void = () => undefined,
    private readonly onDeleted: (userId: number, hostEventCursor: number) => void = () => undefined,
  ) {}

  async create(scope: Scope, command: CreateRunCommand): Promise<RunView> {
    if (!command || typeof command !== 'object') throw new Error('VALIDATION_FAILED');
    const key = requireIdempotencyKey(command.command.key);
    if (!isAgentUuid(command.command.requestId)) throw new Error('VALIDATION_FAILED');
    if (!isAgentUuid(command.threadId)) throw new Error('VALIDATION_FAILED');
    if (
      !command.model ||
      !isAgentUuid(command.model.providerId) ||
      typeof command.model.modelId !== 'string' ||
      !command.model.modelId
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    if (!Number.isSafeInteger(command.model.configurationVersion) || command.model.configurationVersion < 1) {
      throw new Error('VALIDATION_FAILED');
    }
    const input = validateInput(command.input);
    const automaticThreadTitle = deriveAutomaticThreadTitle(input.text);
    const connectionIds = validateConnectionIds(command.connectionIds);
    if (command.environment !== undefined && command.environment !== null && !isRecord(command.environment)) {
      throw new Error('VALIDATION_FAILED');
    }
    const environmentSelection = command.environment ?? null;
    const initialGoal = command.initialGoal === undefined ? undefined : normalizeGoalText(command.initialGoal);
    if (Buffer.byteLength(JSON.stringify({ ...command, input, connectionIds }), 'utf8') > 1024 * 1024) {
      throw new Error('PAYLOAD_TOO_LARGE');
    }

    const [settings, app, provider, executionPolicy] = await Promise.all([
      this.settings.get(scope.userId),
      this.lifecycle.get(scope),
      this.providers.get(scope.userId, command.model.providerId),
      this.executionPolicies.get(scope),
    ]);
    if (!settings.effectiveSettings.feature.enabled) throw new Error('AGENT_DISABLED');
    if (app.desiredState !== 'enabled' || !['running', 'degraded'].includes(app.observedState))
      throw new Error('AGENT_APP_DISABLED');
    if (!app.acceptNewRuns) throw new Error('AGENT_APP_DRAINING');
    this.definitions.require(scope.appId, app.activeVersion, command.agentDefinitionId);
    if (!provider.enabled || provider.version !== command.model.configurationVersion)
      throw new Error('PROVIDER_CONFIGURATION_STALE');
    const model = provider.models.find((candidate) => candidate.id === command.model.modelId);
    if (!model) throw new Error('MODEL_NOT_FOUND');
    const reasoningEffort = command.reasoningEffort ?? model.defaultReasoningEffort;
    if (reasoningEffort !== undefined && !model.reasoningEfforts?.includes(reasoningEffort)) {
      throw new Error('MODEL_REASONING_EFFORT_UNSUPPORTED');
    }

    const budget = runBudgetFrom(settings, executionPolicy, model);
    const environment = environmentSelection
      ? await this.resolveEnvironment(scope, environmentSelection, settings.revision)
      : null;
    const definition: RunDefinitionSnapshot = {
      schemaVersion: 1,
      agentDefinitionId: command.agentDefinitionId,
      model: { ...command.model },
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      approvalMode: command.approvalMode,
      connectionIds,
      environment,
      policyRevision: app.policyRevision,
      settingsRevision: settings.revision,
    };
    const request: JsonValue = {
      threadId: command.threadId,
      input: { text: input.text, artifactRefs: input.artifactRefs },
      agentDefinitionId: command.agentDefinitionId,
      model: {
        providerId: command.model.providerId,
        modelId: command.model.modelId,
        configurationVersion: command.model.configurationVersion,
      },
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      approvalMode: command.approvalMode,
      connectionIds,
      environment: environmentSelection ? (JSON.parse(JSON.stringify(environmentSelection)) as JsonValue) : null,
      ...(initialGoal ? { initialGoal } : {}),
    };
    const committed = await this.stateCommit.createRun({
      scope,
      runId: randomUUID(),
      runtimeId: randomUUID(),
      threadId: command.threadId,
      inputEntryId: randomUUID(),
      input,
      ...(automaticThreadTitle ? { automaticThreadTitle } : {}),
      ...(initialGoal
        ? { initialGoal: { text: initialGoal, revision: 1, updatedAt: this.clock.nowUnixSeconds() } }
        : {}),
      agentDefinitionId: command.agentDefinitionId,
      model: command.model,
      connectionIds,
      budget,
      definition,
      expectedPolicyRevision: app.policyRevision,
      idempotencyKey: key,
      requestHash: requestHash(1, request),
      requestId: command.command.requestId,
      now: this.clock.nowUnixSeconds(),
    });
    if (!committed.replayed) {
      this.onCommitted(committed.run);
      this.onCreated(committed.run);
    }
    logger.debug(
      {
        userId: scope.userId,
        appId: scope.appId,
        runId: committed.run.id,
        threadId: committed.run.threadId,
        status: committed.run.status,
        replayed: committed.replayed,
        agentDefinitionId: command.agentDefinitionId,
        providerId: command.model.providerId,
        modelId: command.model.modelId,
        reasoningEffort: reasoningEffort ?? null,
        approvalMode: command.approvalMode,
        connectionCount: connectionIds.length,
        artifactCount: input.artifactRefs.length,
        inputBytes: Buffer.byteLength(input.text, 'utf8'),
        maxRunTokens: budget.maxRunTokens,
        maxRunSteps: budget.maxRunSteps,
        maxOutputTokens: budget.maxOutputTokens,
      },
      'Agent Run create committed',
    );
    return committed.run;
  }

  async appendInput(
    scope: Scope,
    runId: string,
    input: UserInputData,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<{ inputId: string; sequence: number; runVersion: number }> {
    if (!isAgentUuid(runId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
      throw new Error('VALIDATION_FAILED');
    const normalizedInput = validateInput(input);
    const automaticThreadTitle = deriveAutomaticThreadTitle(normalizedInput.text);
    const key = requireIdempotencyKey(idempotencyKey);
    const hash = requestHash(1, {
      runId,
      input: { text: normalizedInput.text, artifactRefs: normalizedInput.artifactRefs },
      expectedVersion,
    });
    const committed = await this.stateCommit.appendInput({
      scope,
      runId,
      inputEntryId: randomUUID(),
      input: normalizedInput,
      ...(automaticThreadTitle ? { automaticThreadTitle } : {}),
      mode: 'append',
      expectedRunVersion: expectedVersion,
      idempotencyKey: key,
      requestHash: hash,
      now: this.clock.nowUnixSeconds(),
    });
    if (!committed.replayed) {
      this.onCommitted(committed.run);
      if (committed.shouldInterruptModel) this.onInputAppended(committed.run);
      else if (committed.shouldReschedule) this.onCreated(committed.run);
    }
    logger.debug(
      {
        userId: scope.userId,
        appId: scope.appId,
        runId,
        inputId: committed.inputId,
        sequence: committed.sequence,
        runVersion: committed.runVersion,
        replayed: committed.replayed,
        shouldInterruptModel: committed.shouldInterruptModel,
        shouldReschedule: committed.shouldReschedule,
        inputBytes: Buffer.byteLength(normalizedInput.text, 'utf8'),
        artifactCount: normalizedInput.artifactRefs.length,
      },
      'Agent Run input appended',
    );
    return { inputId: committed.inputId, sequence: committed.sequence, runVersion: committed.runVersion };
  }

  async interrupt(
    scope: Scope,
    runId: string,
    input: UserInputData,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<{ inputId: string; sequence: number; runVersion: number }> {
    if (!isAgentUuid(runId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
      throw new Error('VALIDATION_FAILED');
    const normalizedInput = validateInput(input);
    const automaticThreadTitle = deriveAutomaticThreadTitle(normalizedInput.text);
    if (normalizedInput.artifactRefs.length > 0) throw new Error('VALIDATION_FAILED');
    const key = requireIdempotencyKey(idempotencyKey);
    const hash = requestHash(1, {
      runId,
      input: { text: normalizedInput.text, artifactRefs: [] },
      expectedVersion,
      mode: 'interrupt',
    });
    const committed = await this.stateCommit.appendInput({
      scope,
      runId,
      inputEntryId: randomUUID(),
      input: { text: normalizedInput.text, artifactRefs: [] },
      ...(automaticThreadTitle ? { automaticThreadTitle } : {}),
      mode: 'interrupt',
      expectedRunVersion: expectedVersion,
      idempotencyKey: key,
      requestHash: hash,
      now: this.clock.nowUnixSeconds(),
    });
    if (!committed.replayed) {
      this.onCommitted(committed.run);
      this.onInputAppended(committed.run);
    }
    logger.debug(
      {
        userId: scope.userId,
        appId: scope.appId,
        runId,
        inputId: committed.inputId,
        sequence: committed.sequence,
        runVersion: committed.runVersion,
        replayed: committed.replayed,
        inputBytes: Buffer.byteLength(normalizedInput.text, 'utf8'),
      },
      'Agent Run interrupt input committed',
    );
    return { inputId: committed.inputId, sequence: committed.sequence, runVersion: committed.runVersion };
  }

  async setGoal(
    scope: Scope,
    runId: string,
    text: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<RunView> {
    if (!isAgentUuid(runId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error('VALIDATION_FAILED');
    }
    const normalized = normalizeGoalText(text);
    const key = requireIdempotencyKey(idempotencyKey);
    const committed = await this.stateCommit.setRunGoal({
      scope,
      runId,
      text: normalized,
      expectedRunVersion: expectedVersion,
      idempotencyKey: key,
      requestHash: requestHash(1, { runId, text: normalized, expectedVersion }),
      now: this.clock.nowUnixSeconds(),
    });
    if (!committed.replayed) {
      this.onCommitted(committed.run);
      if (committed.shouldInterruptModel) this.onGoalUpdated(committed.run);
      else if (committed.shouldReschedule) this.onCreated(committed.run);
    }
    return committed.run;
  }

  async pendingInputs(scope: Scope, runId: string): Promise<PendingRunInputPage> {
    if (!isAgentUuid(runId)) throw new Error('VALIDATION_FAILED');
    return this.repository.pendingInputs(scope, runId, 50);
  }

  async mutatePendingInput(
    scope: Scope,
    runId: string,
    action: 'remove' | 'move',
    inputId: string,
    beforeInputId: string | null,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<RunView> {
    if (
      !isAgentUuid(runId) ||
      !isAgentUuid(inputId) ||
      (beforeInputId !== null && !isAgentUuid(beforeInputId)) ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1 ||
      !['remove', 'move'].includes(action)
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    if (action === 'remove' && beforeInputId !== null) throw new Error('VALIDATION_FAILED');
    const key = requireIdempotencyKey(idempotencyKey);
    const committed = await this.stateCommit.mutatePendingInput({
      scope,
      runId,
      action,
      inputId,
      beforeInputId,
      expectedRunVersion: expectedVersion,
      idempotencyKey: key,
      requestHash: requestHash(1, { runId, action, inputId, beforeInputId, expectedVersion }),
      now: this.clock.nowUnixSeconds(),
    });
    if (!committed.replayed) {
      this.onCommitted(committed.run);
      this.onInputAppended(committed.run);
    }
    return committed.run;
  }

  async increaseBudget(
    scope: Scope,
    runId: string,
    increase: RunBudgetIncrease,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<RunView> {
    if (!isAgentUuid(runId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error('VALIDATION_FAILED');
    }
    const key = requireIdempotencyKey(idempotencyKey);
    const current = await this.repository.snapshot(scope, runId);
    if (!current) throw new Error('NOT_FOUND');
    if (current.version !== expectedVersion) throw new Error('STATE_CONFLICT');
    if (current.status !== 'awaiting_budget') throw new Error('RUN_NOT_AWAITING_BUDGET');
    const [settings, app] = await Promise.all([this.settings.get(scope.userId), this.lifecycle.get(scope)]);
    if (!settings.effectiveSettings.feature.enabled) throw new Error('AGENT_DISABLED');
    if (app.desiredState !== 'enabled') throw new Error('AGENT_APP_DISABLED');
    const budget = increasedBudget(current.budget, increase, settings.hardLimits);
    const normalizedIncrease: JsonValue = {
      ...(increase.maxRunTokens === undefined ? {} : { maxRunTokens: increase.maxRunTokens }),
      ...(increase.maxRunSteps === undefined ? {} : { maxRunSteps: increase.maxRunSteps }),
      ...(increase.maxActiveExecutionSeconds === undefined
        ? {}
        : { maxActiveExecutionSeconds: increase.maxActiveExecutionSeconds }),
      ...(increase.maxSubagentMessages === undefined ? {} : { maxSubagentMessages: increase.maxSubagentMessages }),
      ...(increase.maxSubagentMessageBytes === undefined
        ? {}
        : { maxSubagentMessageBytes: increase.maxSubagentMessageBytes }),
    };
    const committed = await this.stateCommit.increaseRunBudget({
      scope,
      runId,
      expectedRunVersion: expectedVersion,
      budget,
      idempotencyKey: key,
      requestHash: requestHash(1, { runId, increase: normalizedIncrease, expectedVersion }),
      now: this.clock.nowUnixSeconds(),
    });
    if (!committed.replayed) this.onCommitted(committed.run);
    if (['created', 'running'].includes(committed.run.status)) this.onCreated(committed.run);
    return committed.run;
  }

  async cancel(scope: Scope, runId: string, expectedVersion: number, idempotencyKey: string): Promise<RunView> {
    if (!isAgentUuid(runId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
      throw new Error('VALIDATION_FAILED');
    const key = requireIdempotencyKey(idempotencyKey);
    const committed = await this.stateCommit.cancelRun({
      scope,
      runId,
      expectedRunVersion: expectedVersion,
      idempotencyKey: key,
      requestHash: requestHash(1, { runId, expectedVersion }),
      now: this.clock.nowUnixSeconds(),
    });
    if (!committed.replayed) {
      this.onCommitted(committed.run);
      if (committed.accepted) this.onCancelRequested(runId);
    }
    logger.debug(
      {
        userId: scope.userId,
        appId: scope.appId,
        runId,
        status: committed.run.status,
        accepted: committed.accepted,
        replayed: committed.replayed,
        runVersion: committed.run.version,
      },
      'Agent Run cancellation committed',
    );
    return committed.run;
  }

  async delete(scope: Scope, runId: string, expectedVersion: number, idempotencyKey: string): Promise<void> {
    if (!isAgentUuid(runId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error('VALIDATION_FAILED');
    }
    const key = requireIdempotencyKey(idempotencyKey);
    try {
      const committed = await this.stateCommit.deleteRun({
        scope,
        runId,
        expectedRunVersion: expectedVersion,
        idempotencyKey: key,
        requestHash: requestHash(1, { runId, expectedVersion }),
        now: this.clock.nowUnixSeconds(),
      });
      if (!committed.replayed) this.onDeleted(scope.userId, committed.hostEventCursor);
      logger.info(
        {
          userId: scope.userId,
          appId: scope.appId,
          runId,
          expectedVersion,
          replayed: committed.replayed,
          hostEventCursor: committed.hostEventCursor,
        },
        'Agent Run deleted',
      );
    } catch (cause) {
      logger.warn(
        { err: cause, userId: scope.userId, appId: scope.appId, runId, expectedVersion },
        'Agent Run deletion rejected',
      );
      throw cause;
    }
  }

  async get(scope: Scope, runId: string): Promise<RunSnapshot> {
    if (!isAgentUuid(runId)) throw new Error('VALIDATION_FAILED');
    const run = await this.repository.snapshot(scope, runId);
    if (!run) throw new Error('NOT_FOUND');
    return run;
  }

  list(scope: Scope, threadId: string | undefined, limit = 50, before?: string) {
    if (threadId !== undefined && !isAgentUuid(threadId)) throw new Error('VALIDATION_FAILED');
    return this.repository.list(scope, threadId, limit, before);
  }
}
