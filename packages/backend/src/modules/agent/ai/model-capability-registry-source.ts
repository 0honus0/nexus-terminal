import type { ModelCapabilityDefaults, ReasoningEffort } from './model.types';

export const MODEL_REGISTRY_SOURCE_URL = 'https://models.dev/api.json?type=all';
export const MODEL_REGISTRY_AUTO_UPDATE_INTERVAL_SECONDS = 24 * 60 * 60;
export const MODEL_REGISTRY_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export const MODEL_REGISTRY_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'xai',
  'moonshotai',
  'alibaba',
  'minimax',
  'mistral',
  'cohere',
  'amazon',
  'zhipuai',
  'meta',
  'microsoft',
  'nvidia',
  'bytedance-seed',
] as const;

export interface ModelCapabilityRegistrySnapshot {
  schemaVersion: 1;
  source: 'models.dev';
  sourceUrl: string;
  sourceRevision: string | null;
  generatedAt: number;
  entries: Record<string, ModelCapabilityDefaults>;
}

const reasoningEfforts = new Set<ReasoningEffort>(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const reasoningFrom = (model: Record<string, unknown>): ModelCapabilityDefaults['reasoning'] => {
  if (model.reasoning !== true || !Array.isArray(model.reasoning_options)) return undefined;
  for (const option of model.reasoning_options) {
    if (!isRecord(option) || option.type !== 'effort') continue;
    const efforts = stringList(option.values).filter((effort): effort is ReasoningEffort =>
      reasoningEfforts.has(effort as ReasoningEffort),
    );
    if (efforts.length) return { supportedEfforts: [...new Set(efforts)] };
  }
  return undefined;
};

const defaultsFromModel = (raw: unknown): ModelCapabilityDefaults | null => {
  if (!isRecord(raw) || !isRecord(raw.limit)) return null;
  const contextWindow = raw.limit.context;
  const maxOutputTokens = raw.limit.output;
  if (
    !positiveInteger(contextWindow) ||
    !positiveInteger(maxOutputTokens) ||
    maxOutputTokens > contextWindow ||
    typeof raw.tool_call !== 'boolean'
  ) {
    return null;
  }
  const modalities = isRecord(raw.modalities) ? raw.modalities : {};
  const inputModalities = stringList(modalities.input);
  const reasoning = reasoningFrom(raw);
  return {
    contextWindow,
    maxOutputTokens,
    supportsTools: raw.tool_call,
    supportsImageInput: inputModalities.includes('image'),
    supportsFileInput: inputModalities.includes('file') || inputModalities.includes('pdf'),
    ...(reasoning ? { reasoning } : {}),
  };
};

const normalizeDefaults = (raw: unknown): ModelCapabilityDefaults => {
  if (!isRecord(raw)) throw new Error('MODEL_REGISTRY_CACHE_INVALID');
  const contextWindow = raw.contextWindow;
  const maxOutputTokens = raw.maxOutputTokens;
  const supportsTools = raw.supportsTools;
  if (
    !positiveInteger(contextWindow) ||
    !positiveInteger(maxOutputTokens) ||
    maxOutputTokens > contextWindow ||
    typeof supportsTools !== 'boolean'
  ) {
    throw new Error('MODEL_REGISTRY_CACHE_INVALID');
  }
  const optionalBoolean = (key: string): boolean | undefined => {
    const value = raw[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') throw new Error('MODEL_REGISTRY_CACHE_INVALID');
    return value;
  };
  const supportsImageInput = optionalBoolean('supportsImageInput');
  const supportsFileInput = optionalBoolean('supportsFileInput');
  const supportsPromptCacheKey = optionalBoolean('supportsPromptCacheKey');
  let reasoning: ModelCapabilityDefaults['reasoning'];
  if (raw.reasoning !== undefined) {
    if (!isRecord(raw.reasoning) || !Array.isArray(raw.reasoning.supportedEfforts)) {
      throw new Error('MODEL_REGISTRY_CACHE_INVALID');
    }
    const supportedEfforts = raw.reasoning.supportedEfforts.map((value) => {
      if (typeof value !== 'string' || !reasoningEfforts.has(value as ReasoningEffort)) {
        throw new Error('MODEL_REGISTRY_CACHE_INVALID');
      }
      return value as ReasoningEffort;
    });
    if (!supportedEfforts.length || new Set(supportedEfforts).size !== supportedEfforts.length) {
      throw new Error('MODEL_REGISTRY_CACHE_INVALID');
    }
    const defaultEffort = raw.reasoning.defaultEffort;
    if (
      defaultEffort !== undefined &&
      (typeof defaultEffort !== 'string' ||
        !reasoningEfforts.has(defaultEffort as ReasoningEffort) ||
        !supportedEfforts.includes(defaultEffort as ReasoningEffort))
    ) {
      throw new Error('MODEL_REGISTRY_CACHE_INVALID');
    }
    const mandatory = raw.reasoning.mandatory;
    if (mandatory !== undefined && typeof mandatory !== 'boolean') throw new Error('MODEL_REGISTRY_CACHE_INVALID');
    reasoning = {
      supportedEfforts,
      ...(defaultEffort === undefined ? {} : { defaultEffort: defaultEffort as ReasoningEffort }),
      ...(mandatory === undefined ? {} : { mandatory }),
    };
  }
  return {
    contextWindow,
    maxOutputTokens,
    supportsTools,
    ...(supportsImageInput === undefined ? {} : { supportsImageInput }),
    ...(supportsFileInput === undefined ? {} : { supportsFileInput }),
    ...(supportsPromptCacheKey === undefined ? {} : { supportsPromptCacheKey }),
    ...(reasoning ? { reasoning } : {}),
  };
};

export const parseModelsDevRegistry = (
  raw: unknown,
  metadata: { generatedAt: number; sourceRevision?: string | null },
): ModelCapabilityRegistrySnapshot => {
  if (!isRecord(raw)) throw new Error('MODEL_REGISTRY_RESPONSE_INVALID');
  const entries: Record<string, ModelCapabilityDefaults> = {};
  for (const providerId of MODEL_REGISTRY_PROVIDERS) {
    const provider = raw[providerId];
    if (!isRecord(provider) || !isRecord(provider.models)) continue;
    for (const [modelId, modelRaw] of Object.entries(provider.models)) {
      if (!modelId || modelId.length > 256 || entries[modelId]) continue;
      const defaults = defaultsFromModel(modelRaw);
      if (!defaults) continue;
      entries[modelId] = defaults;
      entries[`${providerId}/${modelId}`] ??= defaults;
    }
  }
  if (Object.keys(entries).length < 25) throw new Error('MODEL_REGISTRY_RESPONSE_INVALID');
  return {
    schemaVersion: 1,
    source: 'models.dev',
    sourceUrl: MODEL_REGISTRY_SOURCE_URL,
    sourceRevision: metadata.sourceRevision ?? null,
    generatedAt: metadata.generatedAt,
    entries,
  };
};

export const validateModelCapabilityRegistrySnapshot = (raw: unknown): ModelCapabilityRegistrySnapshot => {
  if (!isRecord(raw) || raw.schemaVersion !== 1 || raw.source !== 'models.dev' || !isRecord(raw.entries)) {
    throw new Error('MODEL_REGISTRY_CACHE_INVALID');
  }
  if (
    raw.sourceUrl !== MODEL_REGISTRY_SOURCE_URL ||
    (raw.sourceRevision !== null && typeof raw.sourceRevision !== 'string') ||
    !positiveInteger(raw.generatedAt)
  ) {
    throw new Error('MODEL_REGISTRY_CACHE_INVALID');
  }
  const rawEntries = Object.entries(raw.entries);
  if (rawEntries.length < 25 || rawEntries.length > 5_000) throw new Error('MODEL_REGISTRY_CACHE_INVALID');
  const entries: Record<string, ModelCapabilityDefaults> = {};
  for (const [id, defaults] of rawEntries) {
    if (!id.trim() || id.length > 256) throw new Error('MODEL_REGISTRY_CACHE_INVALID');
    entries[id] = normalizeDefaults(defaults);
  }
  return {
    schemaVersion: 1,
    source: 'models.dev',
    sourceUrl: MODEL_REGISTRY_SOURCE_URL,
    sourceRevision: raw.sourceRevision as string | null,
    generatedAt: raw.generatedAt as number,
    entries,
  };
};
