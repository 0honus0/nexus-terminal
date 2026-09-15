import type { Scope } from '../agent.types';
import type { AgentSettingsService, AgentSettingsView } from './agent-settings.service';
import type { AppStoragePort } from './app-storage.port';

export type ContextCompactionMode = 'aggressive' | 'balanced' | 'conservative';

export interface AgentExecutionPolicyOverrides {
  maxRunTokens?: number;
  maxRunSteps?: number;
  maxActiveExecutionSeconds?: number;
  toolTimeoutSeconds?: number;
  maxToolOutputBytes?: number;
  maxRawToolBytes?: number;
  maxRecallItems?: number;
  maxRecallBytes?: number;
  maxSubagentMessages?: number;
  maxSubagentMessageBytes?: number;
  contextCompactionMode?: ContextCompactionMode;
}

export interface AgentExecutionPolicyEffective {
  maxRunTokens: number;
  maxRunSteps: number;
  maxActiveExecutionSeconds: number;
  toolTimeoutSeconds: number;
  maxToolOutputBytes: number;
  maxRawToolBytes: number;
  maxRecallItems: number;
  maxRecallBytes: number;
  maxSubagentMessages: number;
  maxSubagentMessageBytes: number;
  contextCompactionMode: ContextCompactionMode;
}

export interface AgentExecutionPolicyView {
  overrides: AgentExecutionPolicyOverrides;
  effective: AgentExecutionPolicyEffective;
  version: number;
}

const STORAGE_KEY = 'agent.execution-policy.v1';
const modes = new Set<ContextCompactionMode>(['aggressive', 'balanced', 'conservative']);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

const defaultsFrom = (settings: AgentSettingsView): AgentExecutionPolicyEffective => ({
  maxRunTokens: settings.effectiveSettings.budget.maxRunTokens,
  maxRunSteps: settings.effectiveSettings.budget.maxRunSteps,
  maxActiveExecutionSeconds: settings.effectiveSettings.budget.maxActiveExecutionSeconds,
  toolTimeoutSeconds: settings.effectiveSettings.budget.toolTimeoutSeconds,
  maxToolOutputBytes: settings.effectiveSettings.budget.maxToolOutputBytes,
  maxRawToolBytes: settings.effectiveSettings.budget.maxRawToolBytes,
  maxRecallItems: settings.effectiveSettings.budget.maxRecallItems,
  maxRecallBytes: settings.effectiveSettings.budget.maxRecallBytes,
  maxSubagentMessages: settings.effectiveSettings.subagents.maxSubagentMessagesPerRun,
  maxSubagentMessageBytes: settings.effectiveSettings.subagents.maxSubagentMessageBytesPerRun,
  contextCompactionMode: 'balanced',
});

const parseOverrides = (raw: unknown): AgentExecutionPolicyOverrides => {
  if (!isRecord(raw)) throw new Error('VALIDATION_FAILED');
  const allowed = new Set([
    'maxRunTokens',
    'maxRunSteps',
    'maxActiveExecutionSeconds',
    'toolTimeoutSeconds',
    'maxToolOutputBytes',
    'maxRawToolBytes',
    'maxRecallItems',
    'maxRecallBytes',
    'maxSubagentMessages',
    'maxSubagentMessageBytes',
    'contextCompactionMode',
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
  const result: AgentExecutionPolicyOverrides = {};
  for (const key of [
    'maxRunTokens',
    'maxRunSteps',
    'maxActiveExecutionSeconds',
    'toolTimeoutSeconds',
    'maxToolOutputBytes',
    'maxRawToolBytes',
    'maxRecallItems',
    'maxRecallBytes',
    'maxSubagentMessages',
    'maxSubagentMessageBytes',
  ] as const) {
    if (!(key in raw)) continue;
    if (!positiveInteger(raw[key])) throw new Error('VALIDATION_FAILED');
    result[key] = raw[key];
  }
  if ('contextCompactionMode' in raw) {
    if (
      typeof raw.contextCompactionMode !== 'string' ||
      !modes.has(raw.contextCompactionMode as ContextCompactionMode)
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    result.contextCompactionMode = raw.contextCompactionMode as ContextCompactionMode;
  }
  return result;
};

const assertWithinHardLimits = (overrides: AgentExecutionPolicyOverrides, settings: AgentSettingsView): void => {
  const hard = settings.hardLimits;
  const pairs: Array<[keyof AgentExecutionPolicyOverrides, number]> = [
    ['maxRunTokens', hard.maxRunTokens],
    ['maxRunSteps', hard.maxRunSteps],
    ['maxActiveExecutionSeconds', hard.maxActiveExecutionSeconds],
    ['toolTimeoutSeconds', hard.toolTimeoutSeconds],
    ['maxToolOutputBytes', hard.maxToolOutputBytes],
    ['maxRawToolBytes', hard.maxRawToolBytes],
    ['maxRecallItems', hard.maxRecallItems],
    ['maxRecallBytes', hard.maxRecallBytes],
    ['maxSubagentMessages', hard.maxSubagentMessagesPerRun],
    ['maxSubagentMessageBytes', hard.maxSubagentMessageBytesPerRun],
  ];
  for (const [key, limit] of pairs) {
    const value = overrides[key];
    if (typeof value === 'number' && value > limit) throw new Error('BUDGET_HARD_LIMIT_EXCEEDED');
  }
};

export class AgentExecutionPolicyService {
  constructor(
    private readonly storage: AppStoragePort,
    private readonly settings: AgentSettingsService,
  ) {}

  async get(scope: Scope): Promise<AgentExecutionPolicyView> {
    const [stored, settings] = await Promise.all([
      this.storage.get(scope, STORAGE_KEY),
      this.settings.get(scope.userId),
    ]);
    const rawOverrides = stored
      ? isRecord(stored.value) && stored.value.schemaVersion === 1 && isRecord(stored.value.overrides)
        ? stored.value.overrides
        : (() => {
            throw new Error('VALIDATION_FAILED');
          })()
      : {};
    const storedOverrides = { ...rawOverrides };
    delete storedOverrides.maxRunCostMicros;
    const overrides = parseOverrides(storedOverrides);
    assertWithinHardLimits(overrides, settings);
    return {
      overrides,
      effective: { ...defaultsFrom(settings), ...overrides },
      version: stored?.version ?? 0,
    };
  }

  async replace(scope: Scope, raw: unknown, expectedVersion: number): Promise<AgentExecutionPolicyView> {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error('VALIDATION_FAILED');
    const overrides = parseOverrides(raw);
    const settings = await this.settings.get(scope.userId);
    assertWithinHardLimits(overrides, settings);
    const current = await this.storage.get(scope, STORAGE_KEY);
    if ((current?.version ?? 0) !== expectedVersion) throw new Error('SETTINGS_VERSION_CONFLICT');
    const stored = await this.storage.put(
      scope,
      STORAGE_KEY,
      { schemaVersion: 1, overrides: overrides as unknown as import('../agent.types').JsonValue },
      current?.version ?? null,
    );
    return { overrides, effective: { ...defaultsFrom(settings), ...overrides }, version: stored.version };
  }
}
