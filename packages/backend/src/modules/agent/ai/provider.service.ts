import { randomUUID } from 'node:crypto';
import { logErrorCode, logger } from '../../../shared/logging/logger';
import type { ClockPort } from '../agent.types';
import type { LanguageModelPort } from './language-model.port';
import {
  REASONING_EFFORTS,
  deriveCapabilityOverrides,
  resolveModelCapabilityDefaults,
  resolveProviderModelConfig,
} from './model-capability-resolver';
import type {
  DiscoveredProviderModel,
  ModelCapabilityDefaults,
  PersistedProviderModelConfig,
  PersistedProviderView,
  ProviderInput,
  ProviderModelCapabilityObservation,
  ProviderModelCapabilityReport,
  ProviderTestResult,
  ProviderView,
  ReasoningEffort,
  TokenUsage,
} from './model.types';
import type { ProviderRepositoryPort } from './provider.repository.port';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const reasoningEffort = (value: unknown): value is ReasoningEffort =>
  typeof value === 'string' && (REASONING_EFFORTS as readonly string[]).includes(value);

const validateModel = (
  raw: unknown,
  providerCapabilities?: ProviderModelCapabilityObservation,
): PersistedProviderModelConfig => {
  if (!isRecord(raw)) throw new Error('VALIDATION_FAILED');
  const allowed = new Set([
    'id',
    'contextWindow',
    'maxOutputTokens',
    'supportsTools',
    'supportsImageInput',
    'supportsFileInput',
    'supportsPromptCacheKey',
    'capabilitySources',
    'registryDefaults',
    'providerCapabilities',
    'capabilityConflicts',
    'capabilityOverrides',
    'reasoningEfforts',
    'defaultReasoningEffort',
    'reasoningSource',
    'reasoningMandatory',
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
  if (
    !nonEmptyString(raw.id) ||
    !positiveInteger(raw.contextWindow) ||
    !positiveInteger(raw.maxOutputTokens) ||
    raw.maxOutputTokens > raw.contextWindow ||
    typeof raw.supportsTools !== 'boolean' ||
    (raw.supportsImageInput !== undefined && typeof raw.supportsImageInput !== 'boolean') ||
    (raw.supportsFileInput !== undefined && typeof raw.supportsFileInput !== 'boolean') ||
    (raw.supportsPromptCacheKey !== undefined && typeof raw.supportsPromptCacheKey !== 'boolean')
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  if (raw.reasoningEfforts !== undefined) {
    if (
      !Array.isArray(raw.reasoningEfforts) ||
      raw.reasoningEfforts.some((effort) => !reasoningEffort(effort)) ||
      new Set(raw.reasoningEfforts).size !== raw.reasoningEfforts.length
    ) {
      throw new Error('VALIDATION_FAILED');
    }
  }
  if (raw.defaultReasoningEffort !== undefined && !reasoningEffort(raw.defaultReasoningEffort)) {
    throw new Error('VALIDATION_FAILED');
  }
  if (
    raw.defaultReasoningEffort !== undefined &&
    (!Array.isArray(raw.reasoningEfforts) || !raw.reasoningEfforts.includes(raw.defaultReasoningEffort))
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  if (raw.reasoningMandatory !== undefined && typeof raw.reasoningMandatory !== 'boolean') {
    throw new Error('VALIDATION_FAILED');
  }
  const id = raw.id.trim();
  const capabilityOverrides = deriveCapabilityOverrides(
    id,
    {
      contextWindow: raw.contextWindow,
      maxOutputTokens: raw.maxOutputTokens,
      supportsTools: raw.supportsTools,
      ...(raw.supportsImageInput === undefined ? {} : { supportsImageInput: raw.supportsImageInput }),
      ...(raw.supportsFileInput === undefined ? {} : { supportsFileInput: raw.supportsFileInput }),
      ...(raw.supportsPromptCacheKey === undefined ? {} : { supportsPromptCacheKey: raw.supportsPromptCacheKey }),
      ...(Array.isArray(raw.reasoningEfforts) ? { reasoningEfforts: raw.reasoningEfforts as ReasoningEffort[] } : {}),
      ...(raw.defaultReasoningEffort === undefined
        ? {}
        : { defaultReasoningEffort: raw.defaultReasoningEffort as ReasoningEffort }),
      ...(raw.reasoningMandatory === undefined ? {} : { reasoningMandatory: raw.reasoningMandatory }),
    },
    providerCapabilities,
  );
  const model: PersistedProviderModelConfig = {
    id,
    ...(Object.keys(capabilityOverrides).length ? { capabilityOverrides } : {}),
  };
  // Resolve once here so incomplete/invalid Registry + override combinations fail before persistence.
  resolveProviderModelConfig(model, providerCapabilities);
  return model;
};

type ValidatedProviderInput = Omit<ProviderInput, 'models'> & { models: PersistedProviderModelConfig[] };

const validateProviderInput = (
  raw: unknown,
  liveCapabilities: readonly ProviderModelCapabilityObservation[] = [],
): ValidatedProviderInput => {
  if (!isRecord(raw)) throw new Error('VALIDATION_FAILED');
  const allowed = new Set([
    'kind',
    'displayName',
    'baseUrl',
    'protocol',
    'credential',
    'clearCredential',
    'models',
    'enabled',
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
  if (raw.kind !== 'openai-compatible' || !nonEmptyString(raw.displayName) || !nonEmptyString(raw.baseUrl)) {
    throw new Error('VALIDATION_FAILED');
  }
  const protocol = raw.protocol;
  if (protocol !== 'chat-completions' && protocol !== 'responses') throw new Error('VALIDATION_FAILED');
  if (raw.credential !== undefined && (typeof raw.credential !== 'string' || raw.credential.length === 0)) {
    throw new Error('VALIDATION_FAILED');
  }
  if (raw.clearCredential !== undefined && typeof raw.clearCredential !== 'boolean') {
    throw new Error('VALIDATION_FAILED');
  }
  if (raw.credential !== undefined && raw.clearCredential === true) throw new Error('VALIDATION_FAILED');
  if (!Array.isArray(raw.models) || raw.models.length < 1 || raw.models.length > 100) {
    throw new Error('VALIDATION_FAILED');
  }
  const liveByModel = new Map(liveCapabilities.map((observation) => [observation.modelId, observation]));
  const models = raw.models.map((model) => {
    if (!isRecord(model) || typeof model.id !== 'string') return validateModel(model);
    return validateModel(model, liveByModel.get(model.id.trim()));
  });
  if (new Set(models.map((model) => model.id)).size !== models.length) throw new Error('VALIDATION_FAILED');
  if (typeof raw.enabled !== 'boolean') throw new Error('VALIDATION_FAILED');

  let url: URL;
  try {
    url = new URL(raw.baseUrl);
  } catch {
    throw new Error('PROVIDER_ENDPOINT_INVALID');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash || url.username || url.password) {
    throw new Error('PROVIDER_ENDPOINT_INVALID');
  }
  const baseUrl = url.toString().replace(/\/$/, '');

  return {
    kind: 'openai-compatible',
    displayName: raw.displayName.trim(),
    baseUrl,
    protocol,
    ...(raw.credential === undefined ? {} : { credential: raw.credential }),
    ...(raw.clearCredential === undefined ? {} : { clearCredential: raw.clearCredential }),
    models,
    enabled: raw.enabled,
  };
};

const boundedMetadataString = (value: unknown, maxBytes: number): string => {
  if (!nonEmptyString(value)) throw new Error('PROVIDER_CAPABILITY_METADATA_INVALID');
  const normalized = value.trim();
  if (Buffer.byteLength(normalized, 'utf8') > maxBytes) throw new Error('PROVIDER_CAPABILITY_METADATA_INVALID');
  return normalized;
};

const validateCapabilityDefaults = (raw: unknown): ModelCapabilityDefaults => {
  if (!isRecord(raw)) throw new Error('PROVIDER_CAPABILITY_METADATA_INVALID');
  const allowed = new Set([
    'contextWindow',
    'maxOutputTokens',
    'supportsTools',
    'supportsImageInput',
    'supportsFileInput',
    'supportsPromptCacheKey',
    'reasoning',
  ]);
  if (Object.keys(raw).length === 0 || Object.keys(raw).some((key) => !allowed.has(key))) {
    throw new Error('PROVIDER_CAPABILITY_METADATA_INVALID');
  }
  const contextWindow =
    raw.contextWindow === undefined ? undefined : positiveInteger(raw.contextWindow) ? raw.contextWindow : null;
  const maxOutputTokens =
    raw.maxOutputTokens === undefined ? undefined : positiveInteger(raw.maxOutputTokens) ? raw.maxOutputTokens : null;
  if (contextWindow === null || maxOutputTokens === null) throw new Error('PROVIDER_CAPABILITY_METADATA_INVALID');
  if (contextWindow !== undefined && maxOutputTokens !== undefined && maxOutputTokens > contextWindow) {
    throw new Error('PROVIDER_CAPABILITY_METADATA_INVALID');
  }
  for (const field of ['supportsTools', 'supportsImageInput', 'supportsFileInput', 'supportsPromptCacheKey'] as const) {
    if (raw[field] !== undefined && typeof raw[field] !== 'boolean') {
      throw new Error('PROVIDER_CAPABILITY_METADATA_INVALID');
    }
  }
  const supportsTools = raw.supportsTools as boolean | undefined;
  const supportsImageInput = raw.supportsImageInput as boolean | undefined;
  const supportsFileInput = raw.supportsFileInput as boolean | undefined;
  const supportsPromptCacheKey = raw.supportsPromptCacheKey as boolean | undefined;
  let reasoning: ModelCapabilityDefaults['reasoning'];
  if (raw.reasoning !== undefined) {
    if (!isRecord(raw.reasoning)) throw new Error('PROVIDER_CAPABILITY_METADATA_INVALID');
    const reasoningAllowed = new Set(['supportedEfforts', 'defaultEffort', 'mandatory']);
    if (
      Object.keys(raw.reasoning).some((key) => !reasoningAllowed.has(key)) ||
      !Array.isArray(raw.reasoning.supportedEfforts) ||
      raw.reasoning.supportedEfforts.length === 0 ||
      raw.reasoning.supportedEfforts.length > REASONING_EFFORTS.length ||
      raw.reasoning.supportedEfforts.some((effort) => !reasoningEffort(effort)) ||
      new Set(raw.reasoning.supportedEfforts).size !== raw.reasoning.supportedEfforts.length
    ) {
      throw new Error('PROVIDER_CAPABILITY_METADATA_INVALID');
    }
    if (
      raw.reasoning.defaultEffort !== undefined &&
      (!reasoningEffort(raw.reasoning.defaultEffort) ||
        !raw.reasoning.supportedEfforts.includes(raw.reasoning.defaultEffort))
    ) {
      throw new Error('PROVIDER_CAPABILITY_METADATA_INVALID');
    }
    if (raw.reasoning.mandatory !== undefined && typeof raw.reasoning.mandatory !== 'boolean') {
      throw new Error('PROVIDER_CAPABILITY_METADATA_INVALID');
    }
    reasoning = {
      supportedEfforts: [...raw.reasoning.supportedEfforts] as ReasoningEffort[],
      ...(raw.reasoning.defaultEffort === undefined
        ? {}
        : { defaultEffort: raw.reasoning.defaultEffort as ReasoningEffort }),
      ...(raw.reasoning.mandatory === undefined ? {} : { mandatory: raw.reasoning.mandatory }),
    };
  }
  return {
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    ...(supportsTools === undefined ? {} : { supportsTools }),
    ...(supportsImageInput === undefined ? {} : { supportsImageInput }),
    ...(supportsFileInput === undefined ? {} : { supportsFileInput }),
    ...(supportsPromptCacheKey === undefined ? {} : { supportsPromptCacheKey }),
    ...(reasoning === undefined ? {} : { reasoning }),
  };
};

const validateLiveCapabilityReport = (raw: ProviderModelCapabilityReport): ProviderModelCapabilityReport => ({
  source: boundedMetadataString(raw.source, 128),
  sourceVersion: boundedMetadataString(raw.sourceVersion, 256),
  capabilities: validateCapabilityDefaults(raw.capabilities),
});

const testErrorCode = (error: unknown): string => {
  const code = error instanceof Error ? error.message : 'PROVIDER_UNAVAILABLE';
  if (/^[A-Z0-9_]+$/.test(code)) return code;
  if (/^PROVIDER_HTTP_\d+$/.test(code)) return code;
  return 'PROVIDER_UNAVAILABLE';
};

export class ProviderService {
  constructor(
    private readonly repository: ProviderRepositoryPort,
    private readonly languageModel: LanguageModelPort,
    private readonly clock: ClockPort,
    private readonly onChanged: (userId: number) => Promise<void> = async () => undefined,
  ) {}

  private toView(provider: PersistedProviderView): ProviderView {
    const liveByModel = new Map(provider.liveCapabilities.map((observation) => [observation.modelId, observation]));
    const { liveCapabilities: _liveCapabilities, ...view } = provider;
    return {
      ...view,
      models: provider.models.map((model) => resolveProviderModelConfig(model, liveByModel.get(model.id))),
    };
  }

  async list(userId: number): Promise<ProviderView[]> {
    return (await this.repository.list(userId)).map((provider) => this.toView(provider));
  }

  async get(userId: number, providerId: string): Promise<ProviderView> {
    const provider = await this.repository.get(userId, providerId);
    if (!provider) throw new Error('PROVIDER_NOT_FOUND');
    return this.toView(provider);
  }

  async create(userId: number, raw: unknown): Promise<ProviderView> {
    const input = validateProviderInput(raw);
    const now = this.clock.nowUnixSeconds();
    const created = await this.repository.create({
      id: randomUUID(),
      userId,
      kind: input.kind,
      displayName: input.displayName,
      baseUrl: input.baseUrl,
      protocol: input.protocol,
      models: input.models,
      enabled: input.enabled,
      ...(input.credential === undefined ? {} : { credential: input.credential }),
      createdAt: now,
      updatedAt: now,
    });
    try {
      await this.onChanged(userId);
    } catch (error) {
      logger.error(
        {
          userId,
          providerId: created.id,
          providerVersion: created.version,
          errorCode: logErrorCode(error, 'PROVIDER_CHANGE_NOTIFICATION_FAILED'),
        },
        'Agent provider change notification failed after create',
      );
    }
    logger.info(
      {
        userId,
        providerId: created.id,
        providerVersion: created.version,
        enabled: created.enabled,
        modelCount: created.models.length,
      },
      'Agent provider created',
    );
    return this.toView(created);
  }

  async update(userId: number, providerId: string, expectedVersion: number, raw: unknown): Promise<ProviderView> {
    const current = await this.repository.get(userId, providerId);
    if (!current) throw new Error('PROVIDER_NOT_FOUND');
    const input = validateProviderInput(raw, current.liveCapabilities);
    const resetLiveCapabilities = input.baseUrl !== current.baseUrl;
    if (resetLiveCapabilities) {
      for (const model of input.models) resolveProviderModelConfig(model);
    }
    const updated = await this.repository.update(userId, providerId, expectedVersion, {
      displayName: input.displayName,
      baseUrl: input.baseUrl,
      protocol: input.protocol,
      models: input.models,
      enabled: input.enabled,
      ...(input.credential === undefined ? {} : { credential: input.credential }),
      clearCredential: input.clearCredential === true,
      resetLiveCapabilities,
      updatedAt: this.clock.nowUnixSeconds(),
    });
    try {
      await this.onChanged(userId);
    } catch (error) {
      logger.error(
        {
          userId,
          providerId,
          providerVersion: updated.version,
          errorCode: logErrorCode(error, 'PROVIDER_CHANGE_NOTIFICATION_FAILED'),
        },
        'Agent provider change notification failed after update',
      );
    }
    logger.info(
      {
        userId,
        providerId,
        providerVersion: updated.version,
        enabled: updated.enabled,
        modelCount: updated.models.length,
      },
      'Agent provider updated',
    );
    return this.toView(updated);
  }

  async remove(userId: number, providerId: string, expectedVersion: number): Promise<void> {
    await this.repository.remove(userId, providerId, expectedVersion, this.clock.nowUnixSeconds());
    try {
      await this.onChanged(userId);
    } catch (error) {
      logger.error(
        { userId, providerId, expectedVersion, errorCode: logErrorCode(error, 'PROVIDER_CHANGE_NOTIFICATION_FAILED') },
        'Agent provider change notification failed after remove',
      );
    }
    logger.info({ userId, providerId, expectedVersion }, 'Agent provider removed');
  }

  async discoverModels(userId: number, providerId: string): Promise<DiscoveredProviderModel[]> {
    const persisted = await this.repository.get(userId, providerId);
    if (!persisted) throw new Error('PROVIDER_NOT_FOUND');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('PROVIDER_DISCOVERY_TIMEOUT')), 10_000);
    logger.debug({ userId, providerId }, 'Agent provider model discovery started');
    try {
      const discovered = await this.languageModel.discoverModels(userId, providerId, controller.signal);
      const observedAt = this.clock.nowUnixSeconds();
      const existingByModel = new Map(persisted.liveCapabilities.map((item) => [item.modelId, item]));
      let changed = false;
      const result = discovered.map((model) => {
        const registryDefaults = resolveModelCapabilityDefaults(model.id);
        const report = model.liveCapabilityReport
          ? validateLiveCapabilityReport(model.liveCapabilityReport)
          : undefined;
        const observation = report
          ? ({
              modelId: model.id,
              ...report,
              updatedAt: observedAt,
            } satisfies ProviderModelCapabilityObservation)
          : existingByModel.get(model.id);
        if (report) {
          existingByModel.set(model.id, observation!);
          changed = true;
        }
        return {
          id: model.id,
          ...(model.ownedBy === undefined ? {} : { ownedBy: model.ownedBy }),
          ...(model.createdAt === undefined ? {} : { createdAt: model.createdAt }),
          ...(registryDefaults ? { registryDefaults } : {}),
          ...(observation ? { providerCapabilities: observation } : {}),
        };
      });
      if (changed) {
        await this.repository.replaceLiveCapabilities(
          userId,
          providerId,
          [...existingByModel.values()].sort((left, right) => left.modelId.localeCompare(right.modelId)),
        );
      }
      logger.info(
        { userId, providerId, discoveredModelCount: result.length, capabilityObservationChanged: changed },
        'Agent provider model discovery completed',
      );
      return result;
    } catch (error) {
      logger.warn(
        { userId, providerId, errorCode: logErrorCode(error, 'PROVIDER_DISCOVERY_FAILED') },
        'Agent provider model discovery failed',
      );
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async discoverEndpointModels(baseUrl: string, credential?: string): Promise<DiscoveredProviderModel[]> {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new Error('PROVIDER_ENDPOINT_INVALID');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash || url.username || url.password) {
      throw new Error('PROVIDER_ENDPOINT_INVALID');
    }
    const normalizedBaseUrl = url.toString().replace(/\/$/, '');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('PROVIDER_DISCOVERY_TIMEOUT')), 10_000);
    logger.debug({ baseUrl: normalizedBaseUrl }, 'Agent endpoint model discovery started');
    try {
      const discovered = await this.languageModel.discoverEndpointModels(
        normalizedBaseUrl,
        credential?.trim() || undefined,
        controller.signal,
      );
      const observedAt = this.clock.nowUnixSeconds();
      const result = discovered.map((model) => {
        const registryDefaults = resolveModelCapabilityDefaults(model.id);
        const report = model.liveCapabilityReport
          ? validateLiveCapabilityReport(model.liveCapabilityReport)
          : undefined;
        const observation = report
          ? ({
              modelId: model.id,
              ...report,
              updatedAt: observedAt,
            } satisfies ProviderModelCapabilityObservation)
          : undefined;
        return {
          id: model.id,
          ...(model.ownedBy === undefined ? {} : { ownedBy: model.ownedBy }),
          ...(model.createdAt === undefined ? {} : { createdAt: model.createdAt }),
          ...(registryDefaults ? { registryDefaults } : {}),
          ...(observation ? { providerCapabilities: observation } : {}),
        };
      });
      logger.info(
        { baseUrl: normalizedBaseUrl, discoveredModelCount: result.length },
        'Agent endpoint model discovery completed',
      );
      return result;
    } catch (error) {
      logger.warn(
        { baseUrl: normalizedBaseUrl, errorCode: logErrorCode(error, 'PROVIDER_DISCOVERY_FAILED') },
        'Agent endpoint model discovery failed',
      );
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async test(userId: number, providerId: string, modelId: string): Promise<ProviderTestResult> {
    const provider = await this.get(userId, providerId);
    const model = provider.models.find((candidate) => candidate.id === modelId);
    if (!model) throw new Error('MODEL_NOT_FOUND');
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('PROVIDER_TEST_TIMEOUT')), 10_000);
    let usage: TokenUsage | undefined;
    try {
      for await (const event of this.languageModel.stream(
        {
          userId,
          providerId,
          modelId,
          configurationVersion: provider.version,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          ...(model.defaultReasoningEffort === undefined ? {} : { reasoningEffort: model.defaultReasoningEffort }),
          maxOutputTokens: Math.min(16, model.maxOutputTokens),
        },
        controller.signal,
      )) {
        if (event.type === 'usage') usage = event.usage;
      }
      const latencyMs = Date.now() - startedAt;
      logger.info({ userId, providerId, modelId, latencyMs }, 'Agent provider test completed');
      return { ok: true, latencyMs, ...(usage ? { usage } : {}) };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const errorCode = testErrorCode(error);
      logger.warn({ userId, providerId, modelId, latencyMs, errorCode }, 'Agent provider test failed');
      return { ok: false, latencyMs, errorCode };
    } finally {
      clearTimeout(timeout);
    }
  }
}
