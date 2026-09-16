import { randomUUID } from 'node:crypto';
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
  PersistedProviderModelConfig,
  PersistedProviderView,
  ProviderInput,
  ProviderModelConfig,
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

const validateModel = (raw: unknown): PersistedProviderModelConfig => {
  if (!isRecord(raw)) throw new Error('VALIDATION_FAILED');
  const allowed = new Set([
    'id',
    'contextWindow',
    'maxOutputTokens',
    'supportsTools',
    'capabilitySources',
    'registryDefaults',
    'capabilityOverrides',
    'reasoningEfforts',
    'defaultReasoningEffort',
    'reasoningSource',
    'reasoningMandatory',
    'reasoningSupportsMaxTokens',
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
  if (
    !nonEmptyString(raw.id) ||
    !positiveInteger(raw.contextWindow) ||
    !positiveInteger(raw.maxOutputTokens) ||
    raw.maxOutputTokens > raw.contextWindow ||
    typeof raw.supportsTools !== 'boolean'
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
  if (raw.reasoningSupportsMaxTokens !== undefined && typeof raw.reasoningSupportsMaxTokens !== 'boolean') {
    throw new Error('VALIDATION_FAILED');
  }
  const id = raw.id.trim();
  const capabilityOverrides = deriveCapabilityOverrides(id, {
    contextWindow: raw.contextWindow,
    maxOutputTokens: raw.maxOutputTokens,
    supportsTools: raw.supportsTools,
    ...(Array.isArray(raw.reasoningEfforts) ? { reasoningEfforts: raw.reasoningEfforts as ReasoningEffort[] } : {}),
    ...(raw.defaultReasoningEffort === undefined
      ? {}
      : { defaultReasoningEffort: raw.defaultReasoningEffort as ReasoningEffort }),
    ...(raw.reasoningMandatory === undefined ? {} : { reasoningMandatory: raw.reasoningMandatory }),
    ...(raw.reasoningSupportsMaxTokens === undefined
      ? {}
      : { reasoningSupportsMaxTokens: raw.reasoningSupportsMaxTokens }),
  });
  const model: PersistedProviderModelConfig = {
    id,
    ...(Object.keys(capabilityOverrides).length ? { capabilityOverrides } : {}),
  };
  // Resolve once here so incomplete/invalid Registry + override combinations fail before persistence.
  resolveProviderModelConfig(model);
  return model;
};

type ValidatedProviderInput = Omit<ProviderInput, 'models'> & { models: PersistedProviderModelConfig[] };

const validateProviderInput = (raw: unknown): ValidatedProviderInput => {
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
  const protocol = raw.protocol ?? 'chat-completions';
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
  const models = raw.models.map(validateModel);
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
    return {
      ...provider,
      models: provider.models.map(resolveProviderModelConfig),
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
    await this.onChanged(userId);
    return this.toView(created);
  }

  async update(userId: number, providerId: string, expectedVersion: number, raw: unknown): Promise<ProviderView> {
    const input = validateProviderInput(raw);
    const updated = await this.repository.update(userId, providerId, expectedVersion, {
      displayName: input.displayName,
      baseUrl: input.baseUrl,
      protocol: input.protocol,
      models: input.models,
      enabled: input.enabled,
      ...(input.credential === undefined ? {} : { credential: input.credential }),
      clearCredential: input.clearCredential === true,
      updatedAt: this.clock.nowUnixSeconds(),
    });
    await this.onChanged(userId);
    return this.toView(updated);
  }

  async remove(userId: number, providerId: string, expectedVersion: number): Promise<void> {
    await this.repository.remove(userId, providerId, expectedVersion, this.clock.nowUnixSeconds());
    await this.onChanged(userId);
  }

  async discoverModels(userId: number, providerId: string): Promise<DiscoveredProviderModel[]> {
    await this.get(userId, providerId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('PROVIDER_DISCOVERY_TIMEOUT')), 10_000);
    try {
      return (await this.languageModel.discoverModels(userId, providerId, controller.signal)).map((model) => {
        const registryDefaults = resolveModelCapabilityDefaults(model.id);
        return { ...model, ...(registryDefaults ? { registryDefaults } : {}) };
      });
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
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          ...(model.defaultReasoningEffort === undefined ? {} : { reasoningEffort: model.defaultReasoningEffort }),
          maxOutputTokens: Math.min(16, model.maxOutputTokens),
        },
        controller.signal,
      )) {
        if (event.type === 'usage') usage = event.usage;
      }
      return { ok: true, latencyMs: Date.now() - startedAt, ...(usage ? { usage } : {}) };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - startedAt, errorCode: testErrorCode(error) };
    } finally {
      clearTimeout(timeout);
    }
  }
}
