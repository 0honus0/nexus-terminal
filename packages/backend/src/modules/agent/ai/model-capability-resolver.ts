import type {
  ModelCapabilityDefaults,
  ModelCapabilityOverrides,
  PersistedProviderModelConfig,
  ProviderModelConfig,
  ReasoningEffort,
} from './model.types';

export const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

const OPENAI_GPT_56_EFFORTS: ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
const OPENAI_GPT_51_EFFORTS: ReasoningEffort[] = ['none', 'low', 'medium', 'high'];

interface RegistryEntry {
  matches(modelId: string): boolean;
  defaults: ModelCapabilityDefaults;
}

const exact = (ids: readonly string[], defaults: ModelCapabilityDefaults): RegistryEntry => {
  const normalized = new Set(ids.map((id) => id.toLowerCase()));
  return { matches: (modelId) => normalized.has(modelId), defaults };
};

const pattern = (expression: RegExp, defaults: ModelCapabilityDefaults): RegistryEntry => ({
  matches: (modelId) => expression.test(modelId),
  defaults,
});

const REGISTRY: readonly RegistryEntry[] = [
  pattern(/^gpt-5\.6-(?:sol|terra|luna)(?:-\d{4}-\d{2}-\d{2})?$/, {
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    reasoning: {
      supportedEfforts: OPENAI_GPT_56_EFFORTS,
      defaultEffort: 'medium',
    },
  }),
  exact(['gpt-5.6'], {
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    reasoning: {
      supportedEfforts: OPENAI_GPT_56_EFFORTS,
      defaultEffort: 'medium',
    },
  }),
  pattern(/^gpt-5\.1(?:-\d{4}-\d{2}-\d{2})?$/, {
    reasoning: {
      supportedEfforts: OPENAI_GPT_51_EFFORTS,
      defaultEffort: 'none',
    },
  }),
  pattern(/^gpt-5-pro(?:-\d{4}-\d{2}-\d{2})?$/, {
    reasoning: {
      supportedEfforts: ['high'],
      defaultEffort: 'high',
      mandatory: true,
    },
  }),
  exact(['gpt-4o'], {
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsTools: true,
  }),
];

const cloneReasoning = (value: ModelCapabilityDefaults['reasoning']): ModelCapabilityDefaults['reasoning'] =>
  value
    ? {
        supportedEfforts: [...value.supportedEfforts],
        ...(value.defaultEffort === undefined ? {} : { defaultEffort: value.defaultEffort }),
        ...(value.mandatory === undefined ? {} : { mandatory: value.mandatory }),
        ...(value.supportsMaxTokens === undefined ? {} : { supportsMaxTokens: value.supportsMaxTokens }),
      }
    : undefined;

const cloneDefaults = (value: ModelCapabilityDefaults): ModelCapabilityDefaults => ({
  ...(value.contextWindow === undefined ? {} : { contextWindow: value.contextWindow }),
  ...(value.maxOutputTokens === undefined ? {} : { maxOutputTokens: value.maxOutputTokens }),
  ...(value.supportsTools === undefined ? {} : { supportsTools: value.supportsTools }),
  ...(value.reasoning === undefined ? {} : { reasoning: cloneReasoning(value.reasoning)! }),
});

export const resolveModelCapabilityDefaults = (modelId: string): ModelCapabilityDefaults | null => {
  const id = modelId.trim().toLowerCase();
  const entry = REGISTRY.find((candidate) => candidate.matches(id));
  return entry ? cloneDefaults(entry.defaults) : null;
};

const sameEfforts = (
  left: readonly ReasoningEffort[] | undefined,
  right: readonly ReasoningEffort[] | undefined,
): boolean =>
  Boolean(left && right && left.length === right.length && left.every((value, index) => value === right[index]));

export const deriveCapabilityOverrides = (
  modelId: string,
  capability: {
    contextWindow: number;
    maxOutputTokens: number;
    supportsTools: boolean;
    reasoningEfforts?: ReasoningEffort[];
    defaultReasoningEffort?: ReasoningEffort;
    reasoningMandatory?: boolean;
    reasoningSupportsMaxTokens?: boolean;
  },
): ModelCapabilityOverrides => {
  const defaults = resolveModelCapabilityDefaults(modelId);
  const overrides: ModelCapabilityOverrides = {};
  if (defaults?.contextWindow !== capability.contextWindow) overrides.contextWindow = capability.contextWindow;
  if (defaults?.maxOutputTokens !== capability.maxOutputTokens) overrides.maxOutputTokens = capability.maxOutputTokens;
  if (defaults?.supportsTools !== capability.supportsTools) overrides.supportsTools = capability.supportsTools;

  const defaultReasoning = defaults?.reasoning;
  if (capability.reasoningEfforts?.length) {
    const differs =
      !sameEfforts(capability.reasoningEfforts, defaultReasoning?.supportedEfforts) ||
      capability.defaultReasoningEffort !== defaultReasoning?.defaultEffort ||
      capability.reasoningMandatory !== defaultReasoning?.mandatory ||
      capability.reasoningSupportsMaxTokens !== defaultReasoning?.supportsMaxTokens;
    if (differs) {
      overrides.reasoning = {
        supportedEfforts: [...capability.reasoningEfforts],
        ...(capability.defaultReasoningEffort === undefined
          ? {}
          : { defaultEffort: capability.defaultReasoningEffort }),
        ...(capability.reasoningMandatory === undefined ? {} : { mandatory: capability.reasoningMandatory }),
        ...(capability.reasoningSupportsMaxTokens === undefined
          ? {}
          : { supportsMaxTokens: capability.reasoningSupportsMaxTokens }),
      };
    }
  }
  return overrides;
};

/**
 * Persisted compatibility window for provider rows written before `capabilityOverrides` became
 * the canonical models_json shape. New writes are normalized by ProviderService and must not
 * emit the flat fields. Remove this fallback only after a database migration rewrites every
 * supported persisted models_json row to capabilityOverrides and that migration is part of the
 * minimum supported database version.
 */
const legacyOverrides = (model: PersistedProviderModelConfig): ModelCapabilityOverrides => {
  const overrides: ModelCapabilityOverrides = {};
  if (model.contextWindow !== undefined) overrides.contextWindow = model.contextWindow;
  if (model.maxOutputTokens !== undefined) overrides.maxOutputTokens = model.maxOutputTokens;
  if (model.supportsTools !== undefined) overrides.supportsTools = model.supportsTools;
  if (model.reasoningEfforts?.length) {
    overrides.reasoning = {
      supportedEfforts: [...model.reasoningEfforts],
      ...(model.defaultReasoningEffort === undefined ? {} : { defaultEffort: model.defaultReasoningEffort }),
      ...(model.reasoningMandatory === undefined ? {} : { mandatory: model.reasoningMandatory }),
      ...(model.reasoningSupportsMaxTokens === undefined
        ? {}
        : { supportsMaxTokens: model.reasoningSupportsMaxTokens }),
    };
  }
  return overrides;
};

export const resolveProviderModelConfig = (model: PersistedProviderModelConfig): ProviderModelConfig => {
  const defaults = resolveModelCapabilityDefaults(model.id);
  const overrides = model.capabilityOverrides ?? legacyOverrides(model);
  const contextWindow = overrides.contextWindow ?? defaults?.contextWindow;
  const maxOutputTokens = overrides.maxOutputTokens ?? defaults?.maxOutputTokens;
  const supportsTools = overrides.supportsTools ?? defaults?.supportsTools;
  if (!contextWindow || !maxOutputTokens || supportsTools === undefined) throw new Error('MODEL_CAPABILITY_INCOMPLETE');
  if (maxOutputTokens > contextWindow) throw new Error('MODEL_CAPABILITY_INVALID');

  const reasoning = overrides.reasoning ?? defaults?.reasoning;
  const reasoningSource = overrides.reasoning ? 'manual' : defaults?.reasoning ? 'registry' : undefined;
  return {
    id: model.id,
    contextWindow,
    maxOutputTokens,
    supportsTools,
    capabilitySources: {
      contextWindow: overrides.contextWindow !== undefined ? 'manual' : 'registry',
      maxOutputTokens: overrides.maxOutputTokens !== undefined ? 'manual' : 'registry',
      supportsTools: overrides.supportsTools !== undefined ? 'manual' : 'registry',
      ...(reasoningSource === undefined ? {} : { reasoning: reasoningSource }),
    },
    ...(defaults ? { registryDefaults: defaults } : {}),
    ...(Object.keys(overrides).length ? { capabilityOverrides: overrides } : {}),
    ...(reasoning
      ? {
          reasoningEfforts: [...reasoning.supportedEfforts],
          ...(reasoning.defaultEffort === undefined ? {} : { defaultReasoningEffort: reasoning.defaultEffort }),
          ...(reasoningSource === undefined ? {} : { reasoningSource }),
          ...(reasoning.mandatory === undefined ? {} : { reasoningMandatory: reasoning.mandatory }),
          ...(reasoning.supportsMaxTokens === undefined
            ? {}
            : { reasoningSupportsMaxTokens: reasoning.supportsMaxTokens }),
        }
      : {}),
  };
};
