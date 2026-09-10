import { randomUUID } from 'node:crypto';
import type { ClockPort, JsonValue, Scope } from '../../agent.types';
import { ProviderService } from '../../ai/provider.service';
import { AgentSettingsService } from '../../host/agent-settings.service';
import { AppLifecycleService } from '../../host/app-lifecycle.service';
import { isAgentUuid } from '../../uuid';
import type { AgentDefinitionRegistryPort } from '../definitions/agent-definition.port';
import type { RunRepositoryPort } from './run.repository.port';
import { requestHash, requireIdempotencyKey } from './idempotency';
import type { StateCommitPort } from './state-commit.port';
import type {
  CreateRunCommand,
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

const runBudgetFrom = (settings: Awaited<ReturnType<AgentSettingsService['get']>>): RunBudget => ({
  maxContextTokens: settings.effectiveSettings.budget.maxContextTokens,
  maxOutputTokens: settings.effectiveSettings.budget.maxOutputTokens,
  maxRunTokens: settings.effectiveSettings.budget.maxRunTokens,
  maxRunSteps: settings.effectiveSettings.budget.maxRunSteps,
  maxRunCostMicros: settings.effectiveSettings.budget.maxRunCostMicros,
  maxActiveExecutionSeconds: settings.effectiveSettings.budget.maxActiveExecutionSeconds,
  toolTimeoutSeconds: settings.effectiveSettings.budget.toolTimeoutSeconds,
  maxToolOutputBytes: settings.effectiveSettings.budget.maxToolOutputBytes,
  maxRawToolBytes: settings.effectiveSettings.budget.maxRawToolBytes,
  maxRecallItems: settings.effectiveSettings.budget.maxRecallItems,
  maxRecallBytes: settings.effectiveSettings.budget.maxRecallBytes,
  maxSubagentMessages: settings.effectiveSettings.subagents.maxSubagentMessagesPerRun,
  maxSubagentMessageBytes: settings.effectiveSettings.subagents.maxSubagentMessageBytesPerRun,
  revision: settings.revision,
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
    'maxCostMicros',
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

  if ('maxCostMicros' in raw) {
    const target = raw.maxCostMicros;
    if (current.maxRunCostMicros === null) throw new Error('BUDGET_INCREASE_INVALID');
    if (target === null) {
      if (hardLimits.maxRunCostMicros !== null) throw new Error('BUDGET_HARD_LIMIT_EXCEEDED');
      next.maxRunCostMicros = null;
      changed = true;
    } else {
      if (typeof target !== 'number' || !Number.isSafeInteger(target) || target < 0) {
        throw new Error('VALIDATION_FAILED');
      }
      if (target <= current.maxRunCostMicros) throw new Error('BUDGET_INCREASE_INVALID');
      if (hardLimits.maxRunCostMicros !== null && target > hardLimits.maxRunCostMicros) {
        throw new Error('BUDGET_HARD_LIMIT_EXCEEDED');
      }
      next.maxRunCostMicros = target;
      changed = true;
    }
  }
  if (!changed) throw new Error('BUDGET_INCREASE_INVALID');
  next.revision = current.revision + 1;
  return next;
};

export class RunService {
  constructor(
    private readonly settings: AgentSettingsService,
    private readonly lifecycle: AppLifecycleService,
    private readonly providers: ProviderService,
    private readonly definitions: AgentDefinitionRegistryPort,
    private readonly stateCommit: StateCommitPort,
    private readonly repository: RunRepositoryPort,
    private readonly clock: ClockPort,
    private readonly onCreated: (run: RunView) => void = () => undefined,
    private readonly onCommitted: (run: RunView) => void = () => undefined,
    private readonly onInputAppended: (run: RunView) => void = () => undefined,
    private readonly onCancelRequested: (runId: string) => void = () => undefined,
    private readonly onDeleted: (userId: number, hostEventCursor: number) => void = () => undefined,
  ) {}

  async create(scope: Scope, command: CreateRunCommand): Promise<RunView> {
    if (!command || typeof command !== 'object') throw new Error('VALIDATION_FAILED');
    this.definitions.require(scope.appId, command.agentDefinitionId);
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
    const connectionIds = validateConnectionIds(command.connectionIds);
    if (Buffer.byteLength(JSON.stringify({ ...command, input, connectionIds }), 'utf8') > 1024 * 1024) {
      throw new Error('PAYLOAD_TOO_LARGE');
    }

    const [settings, app, provider] = await Promise.all([
      this.settings.get(scope.userId),
      this.lifecycle.get(scope),
      this.providers.get(scope.userId, command.model.providerId),
    ]);
    if (!settings.effectiveSettings.feature.enabled) throw new Error('AGENT_DISABLED');
    if (app.desiredState !== 'enabled' || !['running', 'degraded'].includes(app.observedState))
      throw new Error('AGENT_APP_DISABLED');
    if (!app.acceptNewRuns) throw new Error('AGENT_APP_DRAINING');
    if (!provider.enabled || provider.version !== command.model.configurationVersion)
      throw new Error('PROVIDER_CONFIGURATION_STALE');
    const model = provider.models.find((candidate) => candidate.id === command.model.modelId);
    if (!model) throw new Error('MODEL_NOT_FOUND');

    const budget = runBudgetFrom(settings);
    if (
      budget.maxRunCostMicros !== null &&
      (model.priceMicrosPerMillionInput === undefined || model.priceMicrosPerMillionOutput === undefined)
    ) {
      throw new Error('MODEL_PRICE_UNKNOWN');
    }
    budget.maxContextTokens = Math.min(budget.maxContextTokens, model.contextWindow);
    budget.maxOutputTokens = Math.min(budget.maxOutputTokens, model.maxOutputTokens);
    if (budget.maxOutputTokens >= budget.maxContextTokens) {
      budget.maxOutputTokens = Math.max(1, Math.min(model.maxOutputTokens, budget.maxContextTokens - 1));
    }
    const definition: RunDefinitionSnapshot = {
      schemaVersion: 1,
      agentDefinitionId: command.agentDefinitionId,
      model: { ...command.model },
      connectionIds,
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
      connectionIds,
    };
    const committed = await this.stateCommit.createRun({
      scope,
      runId: randomUUID(),
      runtimeId: randomUUID(),
      threadId: command.threadId,
      inputEntryId: randomUUID(),
      input,
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
    return { inputId: committed.inputId, sequence: committed.sequence, runVersion: committed.runVersion };
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
      ...(!('maxCostMicros' in increase) ? {} : { maxCostMicros: increase.maxCostMicros ?? null }),
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
    return committed.run;
  }

  async delete(scope: Scope, runId: string, expectedVersion: number, idempotencyKey: string): Promise<void> {
    if (!isAgentUuid(runId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error('VALIDATION_FAILED');
    }
    const key = requireIdempotencyKey(idempotencyKey);
    const committed = await this.stateCommit.deleteRun({
      scope,
      runId,
      expectedRunVersion: expectedVersion,
      idempotencyKey: key,
      requestHash: requestHash(1, { runId, expectedVersion }),
      now: this.clock.nowUnixSeconds(),
    });
    if (!committed.replayed) this.onDeleted(scope.userId, committed.hostEventCursor);
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
