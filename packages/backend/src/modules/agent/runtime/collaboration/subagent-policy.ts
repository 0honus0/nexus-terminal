import type { Scope } from '../../agent.types';
import type { ModelRef } from '../../ai/model.types';
import type { ProviderService } from '../../ai/provider.service';
import type { AgentSettingsService } from '../../host/agent-settings.service';
import type { AppStoragePort } from '../../host/app-storage.port';
import { AGENT_CAPABILITIES, type AgentCapability } from '../../host/app.types';
import type {
  PeerMessaging,
  SubagentFailureMode,
  SubagentPolicy,
  SubagentProfile,
  SubagentSettingsView,
} from './subagent.types';

const STORAGE_KEY = 'subagent.profiles.v1';
const MAX_PROFILES = 32;
const MAX_PROFILE_MODELS = 16;
const MAX_PROFILE_CAPABILITIES = AGENT_CAPABILITIES.length;
const PROFILE_ID = /^[a-z][a-z0-9._-]{0,63}$/;
const capabilitySet = new Set<string>(AGENT_CAPABILITIES);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown, maxBytes: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value.trim(), 'utf8') <= maxBytes;
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

const parseModelRef = (raw: unknown): ModelRef => {
  if (!isRecord(raw)) throw new Error('VALIDATION_FAILED');
  if (!nonEmpty(raw.providerId, 128) || !nonEmpty(raw.modelId, 128) || !positiveInteger(raw.configurationVersion)) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    providerId: raw.providerId.trim(),
    modelId: raw.modelId.trim(),
    configurationVersion: raw.configurationVersion,
  };
};

const sameModel = (left: ModelRef, right: ModelRef): boolean =>
  left.providerId === right.providerId &&
  left.modelId === right.modelId &&
  left.configurationVersion === right.configurationVersion;

const parseProfile = (raw: unknown): SubagentProfile => {
  if (!isRecord(raw)) throw new Error('VALIDATION_FAILED');
  const allowed = new Set([
    'id',
    'role',
    'defaultModel',
    'allowedModels',
    'capabilities',
    'peerMessaging',
    'maxTokens',
    'maxSteps',
    'failureMode',
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
  if (!nonEmpty(raw.id, 64) || !PROFILE_ID.test(raw.id.trim()) || !nonEmpty(raw.role, 512)) {
    throw new Error('VALIDATION_FAILED');
  }
  if (
    !Array.isArray(raw.allowedModels) ||
    raw.allowedModels.length < 1 ||
    raw.allowedModels.length > MAX_PROFILE_MODELS
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  const allowedModels = raw.allowedModels.map(parseModelRef);
  const modelKeys = allowedModels.map((model) => JSON.stringify(model));
  if (new Set(modelKeys).size !== modelKeys.length) throw new Error('VALIDATION_FAILED');
  const defaultModel = raw.defaultModel === null ? null : parseModelRef(raw.defaultModel);
  if (defaultModel && !allowedModels.some((model) => sameModel(model, defaultModel)))
    throw new Error('VALIDATION_FAILED');
  if (
    !Array.isArray(raw.capabilities) ||
    raw.capabilities.length > MAX_PROFILE_CAPABILITIES ||
    !raw.capabilities.every((capability) => typeof capability === 'string' && capabilitySet.has(capability))
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  const capabilities = [...new Set(raw.capabilities as AgentCapability[])];
  if (!['parent-child', 'same-run'].includes(String(raw.peerMessaging))) throw new Error('VALIDATION_FAILED');
  if (!positiveInteger(raw.maxTokens) || !positiveInteger(raw.maxSteps)) throw new Error('VALIDATION_FAILED');
  if (!['isolate', 'failFast'].includes(String(raw.failureMode))) throw new Error('VALIDATION_FAILED');
  return {
    id: raw.id.trim(),
    role: raw.role.trim(),
    defaultModel,
    allowedModels,
    capabilities,
    peerMessaging: raw.peerMessaging as PeerMessaging,
    maxTokens: raw.maxTokens,
    maxSteps: raw.maxSteps,
    failureMode: raw.failureMode as SubagentFailureMode,
  };
};

const parseProfiles = (raw: unknown): SubagentProfile[] => {
  if (!isRecord(raw) || !Array.isArray(raw.profiles) || Object.keys(raw).some((key) => key !== 'profiles')) {
    throw new Error('VALIDATION_FAILED');
  }
  if (raw.profiles.length > MAX_PROFILES) throw new Error('VALIDATION_FAILED');
  const profiles = raw.profiles.map(parseProfile);
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) throw new Error('VALIDATION_FAILED');
  return profiles;
};

export class SubagentPolicyService {
  constructor(
    private readonly storage: AppStoragePort,
    private readonly settings: AgentSettingsService,
    private readonly providers: ProviderService,
  ) {}

  async get(scope: Scope): Promise<SubagentSettingsView> {
    const [stored, settings] = await Promise.all([
      this.storage.get(scope, STORAGE_KEY),
      this.settings.get(scope.userId),
    ]);
    const profiles = stored ? parseProfiles(stored.value) : [];
    return {
      policy: {
        maxDelegationDepth: settings.effectiveSettings.subagents.maxDelegationDepth,
        maxMessagesPerRun: settings.effectiveSettings.subagents.maxSubagentMessagesPerRun,
        maxMessageBytesPerRun: settings.effectiveSettings.subagents.maxSubagentMessageBytesPerRun,
        profiles,
      },
      version: stored?.version ?? 0,
    };
  }

  async replaceProfiles(scope: Scope, raw: unknown, expectedVersion: number): Promise<SubagentSettingsView> {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error('VALIDATION_FAILED');
    const profiles = parseProfiles(raw);
    const settings = await this.settings.get(scope.userId);
    for (const profile of profiles) {
      if (
        profile.maxTokens > settings.effectiveSettings.hardLimits.maxRunTokens ||
        profile.maxSteps > settings.effectiveSettings.hardLimits.maxRunSteps
      ) {
        throw new Error('SUBAGENT_PROFILE_HARD_LIMIT_EXCEEDED');
      }
      for (const model of profile.allowedModels) await this.assertModel(scope.userId, model);
    }
    const current = await this.storage.get(scope, STORAGE_KEY);
    if ((current?.version ?? 0) !== expectedVersion) throw new Error('SETTINGS_VERSION_CONFLICT');
    const stored = await this.storage.put(
      scope,
      STORAGE_KEY,
      { profiles: profiles as unknown as import('../../agent.types').JsonValue[] },
      current?.version ?? null,
    );
    const currentSettings = await this.settings.get(scope.userId);
    const policy: SubagentPolicy = {
      maxDelegationDepth: currentSettings.effectiveSettings.subagents.maxDelegationDepth,
      maxMessagesPerRun: currentSettings.effectiveSettings.subagents.maxSubagentMessagesPerRun,
      maxMessageBytesPerRun: currentSettings.effectiveSettings.subagents.maxSubagentMessageBytesPerRun,
      profiles,
    };
    return { policy, version: stored.version };
  }

  private async assertModel(userId: number, model: ModelRef): Promise<void> {
    const provider = await this.providers.get(userId, model.providerId);
    if (!provider.enabled || provider.version !== model.configurationVersion)
      throw new Error('SUBAGENT_MODEL_UNAVAILABLE');
    if (!provider.models.some((candidate) => candidate.id === model.modelId))
      throw new Error('SUBAGENT_MODEL_UNAVAILABLE');
  }
}
