import { randomUUID } from 'node:crypto';
import type { ClockPort } from '../agent.types';
import type { LanguageModelPort } from './language-model.port';
import type { OutboundPolicyPort } from './outbound-policy.port';
import type { ProviderInput, ProviderModelConfig, ProviderTestResult, ProviderView, TokenUsage } from './model.types';
import type { ProviderRepositoryPort } from './provider.repository.port';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const optionalPrice = (value: unknown): value is number | undefined =>
  value === undefined || (Number.isSafeInteger(value) && (value as number) >= 0);

const validateException = (value: string): void => {
  const trimmed = value.trim();
  const match = /^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):(\d{1,5})$/.exec(trimmed);
  const port = match ? Number(match[1]) : 0;
  if (!match || port < 1 || port > 65535) throw new Error('PROVIDER_PRIVATE_EXCEPTION_INVALID');
};

const validateModel = (raw: unknown): ProviderModelConfig => {
  if (!isRecord(raw)) throw new Error('VALIDATION_FAILED');
  const allowed = new Set([
    'id',
    'contextWindow',
    'maxOutputTokens',
    'supportsTools',
    'priceMicrosPerMillionInput',
    'priceMicrosPerMillionOutput',
    'priceVersion',
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
  if (!nonEmptyString(raw.id) || !positiveInteger(raw.contextWindow) || !positiveInteger(raw.maxOutputTokens)) {
    throw new Error('VALIDATION_FAILED');
  }
  if (raw.maxOutputTokens > raw.contextWindow || typeof raw.supportsTools !== 'boolean') {
    throw new Error('VALIDATION_FAILED');
  }
  if (!optionalPrice(raw.priceMicrosPerMillionInput) || !optionalPrice(raw.priceMicrosPerMillionOutput)) {
    throw new Error('VALIDATION_FAILED');
  }
  if (raw.priceVersion !== undefined && !nonEmptyString(raw.priceVersion)) throw new Error('VALIDATION_FAILED');
  if (
    (raw.priceMicrosPerMillionInput !== undefined || raw.priceMicrosPerMillionOutput !== undefined) &&
    !nonEmptyString(raw.priceVersion)
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    id: raw.id.trim(),
    contextWindow: raw.contextWindow,
    maxOutputTokens: raw.maxOutputTokens,
    supportsTools: raw.supportsTools,
    ...(raw.priceMicrosPerMillionInput === undefined
      ? {}
      : { priceMicrosPerMillionInput: raw.priceMicrosPerMillionInput }),
    ...(raw.priceMicrosPerMillionOutput === undefined
      ? {}
      : { priceMicrosPerMillionOutput: raw.priceMicrosPerMillionOutput }),
    ...(raw.priceVersion === undefined ? {} : { priceVersion: raw.priceVersion.trim() }),
  };
};

const validateProviderInput = (raw: unknown): ProviderInput => {
  if (!isRecord(raw)) throw new Error('VALIDATION_FAILED');
  const allowed = new Set([
    'kind',
    'displayName',
    'baseUrl',
    'credential',
    'clearCredential',
    'models',
    'privateHostExceptions',
    'enabled',
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
  if (raw.kind !== 'openai-compatible' || !nonEmptyString(raw.displayName) || !nonEmptyString(raw.baseUrl)) {
    throw new Error('VALIDATION_FAILED');
  }
  if (raw.credential !== undefined && (typeof raw.credential !== 'string' || raw.credential.length === 0)) {
    throw new Error('VALIDATION_FAILED');
  }
  if (raw.clearCredential !== undefined && typeof raw.clearCredential !== 'boolean')
    throw new Error('VALIDATION_FAILED');
  if (raw.credential !== undefined && raw.clearCredential === true) throw new Error('VALIDATION_FAILED');
  if (!Array.isArray(raw.models) || raw.models.length < 1 || raw.models.length > 100)
    throw new Error('VALIDATION_FAILED');
  const models = raw.models.map(validateModel);
  if (new Set(models.map((model) => model.id)).size !== models.length) throw new Error('VALIDATION_FAILED');
  if (!Array.isArray(raw.privateHostExceptions) || !raw.privateHostExceptions.every(nonEmptyString)) {
    throw new Error('VALIDATION_FAILED');
  }
  const privateHostExceptions = [...new Set(raw.privateHostExceptions.map((item) => item.trim().toLowerCase()))];
  privateHostExceptions.forEach(validateException);
  if (typeof raw.enabled !== 'boolean') throw new Error('VALIDATION_FAILED');

  let url: URL;
  try {
    url = new URL(raw.baseUrl);
  } catch {
    throw new Error('PROVIDER_ENDPOINT_INVALID');
  }
  if (url.search || url.hash || url.username || url.password) throw new Error('PROVIDER_ENDPOINT_INVALID');
  const baseUrl = url.toString().replace(/\/$/, '');

  return {
    kind: 'openai-compatible',
    displayName: raw.displayName.trim(),
    baseUrl,
    ...(raw.credential === undefined ? {} : { credential: raw.credential }),
    ...(raw.clearCredential === undefined ? {} : { clearCredential: raw.clearCredential }),
    models,
    privateHostExceptions,
    enabled: raw.enabled,
  };
};

const testErrorCode = (error: unknown): string => {
  const code = error instanceof Error ? error.message : 'PROVIDER_UNAVAILABLE';
  if (/^[A-Z0-9_]+$/.test(code)) return code;
  if (/^PROVIDER_HTTP_\d+$/.test(code)) return code;
  return 'PROVIDER_UNAVAILABLE';
};

export const calculateModelCostMicros = (
  model: ProviderModelConfig,
  inputTokens: number,
  outputTokens: number,
): number | null => {
  if (model.priceMicrosPerMillionInput === undefined || model.priceMicrosPerMillionOutput === undefined) return null;
  const numerator =
    BigInt(inputTokens) * BigInt(model.priceMicrosPerMillionInput) +
    BigInt(outputTokens) * BigInt(model.priceMicrosPerMillionOutput);
  const cost = (numerator + 999_999n) / 1_000_000n;
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('MODEL_COST_OVERFLOW');
  return Number(cost);
};

export class ProviderService {
  constructor(
    private readonly repository: ProviderRepositoryPort,
    private readonly outboundPolicy: OutboundPolicyPort,
    private readonly languageModel: LanguageModelPort,
    private readonly clock: ClockPort,
    private readonly onChanged: (userId: number) => Promise<void> = async () => undefined,
  ) {}

  list(userId: number): Promise<ProviderView[]> {
    return this.repository.list(userId);
  }

  async get(userId: number, providerId: string): Promise<ProviderView> {
    const provider = await this.repository.get(userId, providerId);
    if (!provider) throw new Error('PROVIDER_NOT_FOUND');
    return provider;
  }

  async create(userId: number, raw: unknown): Promise<ProviderView> {
    const input = validateProviderInput(raw);
    await this.outboundPolicy.resolve(input.baseUrl, input.privateHostExceptions);
    const now = this.clock.nowUnixSeconds();
    const created = await this.repository.create({
      id: randomUUID(),
      userId,
      kind: input.kind,
      displayName: input.displayName,
      baseUrl: input.baseUrl,
      models: input.models,
      privateHostExceptions: input.privateHostExceptions,
      enabled: input.enabled,
      ...(input.credential === undefined ? {} : { credential: input.credential }),
      createdAt: now,
      updatedAt: now,
    });
    await this.onChanged(userId);
    return created;
  }

  async update(userId: number, providerId: string, expectedVersion: number, raw: unknown): Promise<ProviderView> {
    const input = validateProviderInput(raw);
    await this.outboundPolicy.resolve(input.baseUrl, input.privateHostExceptions);
    const updated = await this.repository.update(userId, providerId, expectedVersion, {
      displayName: input.displayName,
      baseUrl: input.baseUrl,
      models: input.models,
      privateHostExceptions: input.privateHostExceptions,
      enabled: input.enabled,
      ...(input.credential === undefined ? {} : { credential: input.credential }),
      clearCredential: input.clearCredential === true,
      updatedAt: this.clock.nowUnixSeconds(),
    });
    await this.onChanged(userId);
    return updated;
  }

  async remove(userId: number, providerId: string, expectedVersion: number): Promise<void> {
    await this.repository.remove(userId, providerId, expectedVersion, this.clock.nowUnixSeconds());
    await this.onChanged(userId);
  }

  async discoverModels(userId: number, providerId: string) {
    await this.get(userId, providerId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('PROVIDER_DISCOVERY_TIMEOUT')), 10_000);
    try {
      return await this.languageModel.discoverModels(userId, providerId, controller.signal);
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
