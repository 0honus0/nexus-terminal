import { createHash } from 'node:crypto';
import type {
  ModelCapabilityDefaults,
  ProviderModelCapabilityReport,
  ReasoningEffort,
} from '../../../modules/agent/ai/model.types';

const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const REASONING_EFFORT_SET = new Set<string>(REASONING_EFFORTS);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

const metadataInvalid = (): Error => new Error('PROVIDER_CAPABILITY_METADATA_INVALID');

const optionalBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw metadataInvalid();
  return value;
};

const optionalPositiveInteger = (value: unknown): number | undefined => {
  if (value === undefined) return undefined;
  if (!positiveInteger(value)) throw metadataInvalid();
  return value;
};

const parseReasoning = (raw: unknown): ModelCapabilityDefaults['reasoning'] => {
  if (!isRecord(raw)) throw metadataInvalid();
  const record = raw;
  const allowed = new Set(['supported_efforts', 'default_effort', 'mandatory']);
  if (Object.keys(record).some((key) => !allowed.has(key))) throw metadataInvalid();
  const rawSupported = record.supported_efforts;
  if (
    !Array.isArray(rawSupported) ||
    rawSupported.length < 1 ||
    rawSupported.length > REASONING_EFFORTS.length ||
    rawSupported.some((effort) => typeof effort !== 'string' || !REASONING_EFFORT_SET.has(effort)) ||
    new Set(rawSupported).size !== rawSupported.length
  ) {
    throw metadataInvalid();
  }
  const supported = REASONING_EFFORTS.filter((effort) => rawSupported.includes(effort)) as ReasoningEffort[];
  const defaultEffort = record.default_effort;
  if (
    defaultEffort !== undefined &&
    (typeof defaultEffort !== 'string' || !supported.includes(defaultEffort as ReasoningEffort))
  ) {
    throw metadataInvalid();
  }
  const mandatory = optionalBoolean(record.mandatory);
  return {
    supportedEfforts: supported,
    ...(defaultEffort === undefined ? {} : { defaultEffort: defaultEffort as ReasoningEffort }),
    ...(mandatory === undefined ? {} : { mandatory }),
  };
};

/**
 * Parse the explicit Nexus capability extension on one OpenAI-compatible /models entry.
 * Missing metadata is intentionally non-authoritative; malformed explicit metadata fails closed.
 */
export const parseOpenAiCompatibleCapabilityMetadata = (
  raw: unknown,
  providerBaseUrl: string,
): ProviderModelCapabilityReport | undefined => {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw metadataInvalid();
  const record = raw;
  const allowed = new Set([
    'schema_version',
    'context_window',
    'max_output_tokens',
    'supports_tools',
    'supports_image_input',
    'supports_file_input',
    'supports_prompt_cache_key',
    'reasoning',
  ]);
  const keys = Object.keys(record);
  if (record.schema_version !== 1 || keys.some((key) => !allowed.has(key)) || keys.length < 2) {
    throw metadataInvalid();
  }

  const contextWindow = optionalPositiveInteger(record.context_window);
  const maxOutputTokens = optionalPositiveInteger(record.max_output_tokens);
  if (contextWindow !== undefined && maxOutputTokens !== undefined && maxOutputTokens > contextWindow) {
    throw metadataInvalid();
  }

  const supportsTools = optionalBoolean(record.supports_tools);
  const supportsImageInput = optionalBoolean(record.supports_image_input);
  const supportsFileInput = optionalBoolean(record.supports_file_input);
  const supportsPromptCacheKey = optionalBoolean(record.supports_prompt_cache_key);
  const reasoning = record.reasoning === undefined ? undefined : parseReasoning(record.reasoning);
  const capabilities: ModelCapabilityDefaults = {
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    ...(supportsTools === undefined ? {} : { supportsTools }),
    ...(supportsImageInput === undefined ? {} : { supportsImageInput }),
    ...(supportsFileInput === undefined ? {} : { supportsFileInput }),
    ...(supportsPromptCacheKey === undefined ? {} : { supportsPromptCacheKey }),
    ...(reasoning === undefined ? {} : { reasoning }),
  };
  if (Object.keys(capabilities).length === 0) throw metadataInvalid();

  const sourceFingerprint = createHash('sha256').update(providerBaseUrl, 'utf8').digest('base64url');
  const contentRevision = createHash('sha256').update(JSON.stringify(capabilities), 'utf8').digest('base64url');
  return {
    source: `openai-compatible:${sourceFingerprint}:/models:nexus_capabilities`,
    sourceVersion: `schema-1:sha256:${contentRevision}`,
    capabilities,
  };
};
