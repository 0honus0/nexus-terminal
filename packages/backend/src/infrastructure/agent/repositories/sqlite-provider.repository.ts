import type {
  ProviderCreateRecord,
  ProviderRepositoryPort,
  ProviderUpdateRecord,
} from '../../../modules/agent/ai/provider.repository.port';
import type {
  OpenAiCompatibleProtocol,
  PersistedProviderModelConfig,
  PersistedProviderView,
  ProviderModelCapabilityObservation,
} from '../../../modules/agent/ai/model.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import type { SecretCipher } from '../../../shared/security/crypto.port';
import {
  durableBoolean,
  durableInteger,
  durableRecord,
  durableString,
  parseDurableJson,
} from '../runtime/durable-state-decoders';

interface ProviderRow {
  id: string;
  kind: 'openai-compatible';
  display_name: string;
  base_url: string;
  protected_credential: string | null;
  credential_revision: number;
  models_json: string;
  live_capabilities_json: string;
  endpoint_policy_json: string;
  enabled: number;
  version: number;
  created_at: number;
  updated_at: number;
}

const columns = `
  id, kind, display_name, base_url, protected_credential, credential_revision,
  models_json, live_capabilities_json, endpoint_policy_json, enabled, version, created_at, updated_at
`;

const protocolFromPolicy = (raw: string): OpenAiCompatibleProtocol => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('PROVIDER_ENDPOINT_POLICY_INVALID');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PROVIDER_ENDPOINT_POLICY_INVALID');
  if (Object.keys(value).length !== 1 || !('protocol' in value)) throw new Error('PROVIDER_ENDPOINT_POLICY_INVALID');
  const protocol = (value as { protocol?: unknown }).protocol;
  if (protocol === 'chat-completions') return 'chat-completions';
  if (protocol === 'responses') return 'responses';
  throw new Error('PROVIDER_ENDPOINT_POLICY_INVALID');
};

const reasoningEfforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

const assertAllowedKeys = (record: Record<string, unknown>, allowed: readonly string[]): void => {
  const allowedSet = new Set(allowed);
  if (Object.keys(record).some((key) => !allowedSet.has(key))) throw new Error('AGENT_DURABLE_STATE_INVALID');
};

const decodeReasoning = (
  value: unknown,
): NonNullable<PersistedProviderModelConfig['capabilityOverrides']>['reasoning'] => {
  const record = durableRecord(value);
  assertAllowedKeys(record, ['supportedEfforts', 'defaultEffort', 'mandatory']);
  if (!Array.isArray(record.supportedEfforts) || record.supportedEfforts.length > reasoningEfforts.size) {
    throw new Error('AGENT_DURABLE_STATE_INVALID');
  }
  const supportedEfforts = record.supportedEfforts.map((effort) => {
    if (typeof effort !== 'string' || !reasoningEfforts.has(effort)) throw new Error('AGENT_DURABLE_STATE_INVALID');
    return effort as 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  });
  if (new Set(supportedEfforts).size !== supportedEfforts.length) throw new Error('AGENT_DURABLE_STATE_INVALID');
  const defaultEffort = record.defaultEffort;
  if (
    defaultEffort !== undefined &&
    (typeof defaultEffort !== 'string' || !supportedEfforts.includes(defaultEffort as never))
  ) {
    throw new Error('AGENT_DURABLE_STATE_INVALID');
  }
  return {
    supportedEfforts,
    ...(defaultEffort === undefined ? {} : { defaultEffort: defaultEffort as (typeof supportedEfforts)[number] }),
    ...(record.mandatory === undefined ? {} : { mandatory: durableBoolean(record.mandatory) }),
  };
};

const optionalPositiveInteger = (value: unknown): number | undefined =>
  value === undefined ? undefined : durableInteger(value, 1);

const boundedNonEmptyString = (value: unknown, maxBytes: number): string => {
  const text = (durableString(value) as string).trim();
  if (!text || Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('AGENT_DURABLE_STATE_INVALID');
  return text;
};

export const decodeProviderLiveCapabilities = (raw: string): ProviderModelCapabilityObservation[] => {
  const value = parseDurableJson(raw);
  if (!Array.isArray(value) || value.length > 1024) throw new Error('AGENT_DURABLE_STATE_INVALID');
  const seen = new Set<string>();
  return value.map((item) => {
    const record = durableRecord(item);
    assertAllowedKeys(record, ['modelId', 'source', 'sourceVersion', 'capabilities', 'updatedAt']);
    const modelId = boundedNonEmptyString(record.modelId, 512);
    if (seen.has(modelId)) throw new Error('AGENT_DURABLE_STATE_INVALID');
    seen.add(modelId);
    const capabilities = durableRecord(record.capabilities);
    assertAllowedKeys(capabilities, [
      'contextWindow',
      'maxOutputTokens',
      'supportsTools',
      'supportsImageInput',
      'supportsFileInput',
      'supportsPromptCacheKey',
      'reasoning',
    ]);
    if (Object.keys(capabilities).length === 0) throw new Error('AGENT_DURABLE_STATE_INVALID');
    const contextWindow = optionalPositiveInteger(capabilities.contextWindow);
    const maxOutputTokens = optionalPositiveInteger(capabilities.maxOutputTokens);
    if (contextWindow !== undefined && maxOutputTokens !== undefined && maxOutputTokens > contextWindow) {
      throw new Error('AGENT_DURABLE_STATE_INVALID');
    }
    return {
      modelId,
      source: boundedNonEmptyString(record.source, 128),
      sourceVersion: boundedNonEmptyString(record.sourceVersion, 256),
      capabilities: {
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
        ...(capabilities.supportsTools === undefined
          ? {}
          : { supportsTools: durableBoolean(capabilities.supportsTools) }),
        ...(capabilities.supportsImageInput === undefined
          ? {}
          : { supportsImageInput: durableBoolean(capabilities.supportsImageInput) }),
        ...(capabilities.supportsFileInput === undefined
          ? {}
          : { supportsFileInput: durableBoolean(capabilities.supportsFileInput) }),
        ...(capabilities.supportsPromptCacheKey === undefined
          ? {}
          : { supportsPromptCacheKey: durableBoolean(capabilities.supportsPromptCacheKey) }),
        ...(capabilities.reasoning === undefined ? {} : { reasoning: decodeReasoning(capabilities.reasoning) }),
      },
      updatedAt: durableInteger(record.updatedAt),
    };
  });
};

export const decodePersistedProviderModels = (raw: string): PersistedProviderModelConfig[] => {
  const value = parseDurableJson(raw);
  if (!Array.isArray(value) || value.length > 1024) throw new Error('AGENT_DURABLE_STATE_INVALID');
  return value.map((item) => {
    const record = durableRecord(item);
    assertAllowedKeys(record, ['id', 'capabilityOverrides']);
    const id = durableString(record.id) as string;
    if (!id.trim()) throw new Error('AGENT_DURABLE_STATE_INVALID');
    const overridesRaw = record.capabilityOverrides;
    const capabilityOverrides =
      overridesRaw === undefined
        ? undefined
        : (() => {
            const overrides = durableRecord(overridesRaw);
            assertAllowedKeys(overrides, [
              'contextWindow',
              'maxOutputTokens',
              'supportsTools',
              'supportsImageInput',
              'supportsFileInput',
              'supportsPromptCacheKey',
              'reasoning',
            ]);
            return {
              ...(overrides.contextWindow === undefined
                ? {}
                : { contextWindow: durableInteger(overrides.contextWindow, 1) }),
              ...(overrides.maxOutputTokens === undefined
                ? {}
                : { maxOutputTokens: durableInteger(overrides.maxOutputTokens, 1) }),
              ...(overrides.supportsTools === undefined
                ? {}
                : { supportsTools: durableBoolean(overrides.supportsTools) }),
              ...(overrides.supportsImageInput === undefined
                ? {}
                : { supportsImageInput: durableBoolean(overrides.supportsImageInput) }),
              ...(overrides.supportsFileInput === undefined
                ? {}
                : { supportsFileInput: durableBoolean(overrides.supportsFileInput) }),
              ...(overrides.supportsPromptCacheKey === undefined
                ? {}
                : { supportsPromptCacheKey: durableBoolean(overrides.supportsPromptCacheKey) }),
              ...(overrides.reasoning === undefined ? {} : { reasoning: decodeReasoning(overrides.reasoning) }),
            };
          })();
    return {
      id,
      ...(capabilityOverrides === undefined ? {} : { capabilityOverrides }),
    };
  });
};

const mapRow = (row: ProviderRow): PersistedProviderView => {
  const persistedModels = decodePersistedProviderModels(row.models_json);
  return {
    id: row.id,
    kind: row.kind,
    displayName: row.display_name,
    baseUrl: row.base_url,
    protocol: protocolFromPolicy(row.endpoint_policy_json),
    hasCredential: Boolean(row.protected_credential),
    credentialRevision: row.credential_revision,
    models: persistedModels,
    liveCapabilities: decodeProviderLiveCapabilities(row.live_capabilities_json),
    enabled: row.enabled === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export class SqliteProviderRepository implements ProviderRepositoryPort {
  constructor(
    private readonly db: RelationalDatabase,
    private readonly cipher: SecretCipher,
  ) {}

  async get(userId: number, providerId: string): Promise<PersistedProviderView | null> {
    const row = await this.db.queryOne<ProviderRow>(
      `SELECT ${columns} FROM ai_providers
       WHERE user_id = ? AND id = ? AND deleted_at IS NULL`,
      [userId, providerId],
    );
    return row ? mapRow(row) : null;
  }

  async list(userId: number): Promise<PersistedProviderView[]> {
    const rows = await this.db.queryAll<ProviderRow>(
      `SELECT ${columns} FROM ai_providers
       WHERE user_id = ? AND deleted_at IS NULL
       ORDER BY display_name COLLATE NOCASE, id`,
      [userId],
    );
    return rows.map(mapRow);
  }

  async create(record: ProviderCreateRecord): Promise<PersistedProviderView> {
    const protectedCredential = record.credential === undefined ? null : this.cipher.encrypt(record.credential);
    await this.db.execute(
      `INSERT INTO ai_providers (
        id, user_id, kind, display_name, base_url, protected_credential, credential_revision,
        models_json, endpoint_policy_json, enabled, deleted_at, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, 1, ?, ?)`,
      [
        record.id,
        record.userId,
        record.kind,
        record.displayName,
        record.baseUrl,
        protectedCredential,
        JSON.stringify(record.models),
        JSON.stringify({ protocol: record.protocol }),
        record.enabled ? 1 : 0,
        record.createdAt,
        record.updatedAt,
      ],
    );
    const created = await this.get(record.userId, record.id);
    if (!created) throw new Error('PROVIDER_NOT_FOUND');
    return created;
  }

  async update(
    userId: number,
    providerId: string,
    expectedVersion: number,
    record: ProviderUpdateRecord,
  ): Promise<PersistedProviderView> {
    const credentialSql =
      record.credential !== undefined
        ? ', protected_credential = ?, credential_revision = credential_revision + 1'
        : record.clearCredential
          ? ', protected_credential = NULL, credential_revision = credential_revision + 1'
          : '';
    const liveCapabilitiesSql = record.resetLiveCapabilities ? ", live_capabilities_json = '[]'" : '';
    const parameters: unknown[] = [
      record.displayName,
      record.baseUrl,
      JSON.stringify(record.models),
      JSON.stringify({ protocol: record.protocol }),
      record.enabled ? 1 : 0,
      record.updatedAt,
    ];
    if (record.credential !== undefined) parameters.push(this.cipher.encrypt(record.credential));
    parameters.push(userId, providerId, expectedVersion);

    const result = await this.db.execute(
      `UPDATE ai_providers SET
        display_name = ?, base_url = ?, models_json = ?, endpoint_policy_json = ?, enabled = ?,
        updated_at = ?, version = version + 1${credentialSql}${liveCapabilitiesSql}
       WHERE user_id = ? AND id = ? AND version = ? AND deleted_at IS NULL`,
      parameters,
    );
    if (result.changes !== 1) {
      if (await this.get(userId, providerId)) throw new Error('PROVIDER_VERSION_CONFLICT');
      throw new Error('PROVIDER_NOT_FOUND');
    }
    const updated = await this.get(userId, providerId);
    if (!updated) throw new Error('PROVIDER_NOT_FOUND');
    return updated;
  }

  async replaceLiveCapabilities(
    userId: number,
    providerId: string,
    observations: ProviderModelCapabilityObservation[],
  ): Promise<void> {
    const encoded = JSON.stringify(observations);
    decodeProviderLiveCapabilities(encoded);
    const result = await this.db.execute(
      `UPDATE ai_providers SET live_capabilities_json = ?
       WHERE user_id = ? AND id = ? AND deleted_at IS NULL`,
      [encoded, userId, providerId],
    );
    if (result.changes !== 1) throw new Error('PROVIDER_NOT_FOUND');
  }

  async remove(userId: number, providerId: string, expectedVersion: number, deletedAt: number): Promise<void> {
    const result = await this.db.execute(
      `UPDATE ai_providers SET
        protected_credential = NULL,
        credential_revision = credential_revision + 1,
        enabled = 0,
        deleted_at = ?,
        updated_at = ?,
        version = version + 1
       WHERE user_id = ? AND id = ? AND version = ? AND deleted_at IS NULL`,
      [deletedAt, deletedAt, userId, providerId, expectedVersion],
    );
    if (result.changes === 1) return;
    if (await this.get(userId, providerId)) throw new Error('PROVIDER_VERSION_CONFLICT');
    throw new Error('PROVIDER_NOT_FOUND');
  }
}
