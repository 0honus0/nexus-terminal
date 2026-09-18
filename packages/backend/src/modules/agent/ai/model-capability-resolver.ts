import type {
  ModelCapabilityDefaults,
  ModelCapabilityField,
  ModelCapabilityOverrides,
  ModelCapabilitySnapshot,
  ModelCapabilitySource,
  PersistedProviderModelConfig,
  ProviderModelCapabilityObservation,
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
    supportsPromptCacheKey: true,
    reasoning: {
      supportedEfforts: OPENAI_GPT_56_EFFORTS,
      defaultEffort: 'medium',
    },
  }),
  exact(['gpt-5.6'], {
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsPromptCacheKey: true,
    reasoning: {
      supportedEfforts: OPENAI_GPT_56_EFFORTS,
      defaultEffort: 'medium',
    },
  }),
  pattern(/^gpt-5\.1(?:-\d{4}-\d{2}-\d{2})?$/, {
    supportsPromptCacheKey: true,
    reasoning: {
      supportedEfforts: OPENAI_GPT_51_EFFORTS,
      defaultEffort: 'none',
    },
  }),
  pattern(/^gpt-5-pro(?:-\d{4}-\d{2}-\d{2})?$/, {
    supportsPromptCacheKey: true,
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
    supportsImageInput: true,
    supportsPromptCacheKey: true,
  }),
];

const cloneReasoning = (value: ModelCapabilityDefaults['reasoning']): ModelCapabilityDefaults['reasoning'] =>
  value
    ? {
        supportedEfforts: [...value.supportedEfforts],
        ...(value.defaultEffort === undefined ? {} : { defaultEffort: value.defaultEffort }),
        ...(value.mandatory === undefined ? {} : { mandatory: value.mandatory }),
      }
    : undefined;

const cloneDefaults = (value: ModelCapabilityDefaults): ModelCapabilityDefaults => ({
  ...(value.contextWindow === undefined ? {} : { contextWindow: value.contextWindow }),
  ...(value.maxOutputTokens === undefined ? {} : { maxOutputTokens: value.maxOutputTokens }),
  ...(value.supportsTools === undefined ? {} : { supportsTools: value.supportsTools }),
  ...(value.supportsImageInput === undefined ? {} : { supportsImageInput: value.supportsImageInput }),
  ...(value.supportsFileInput === undefined ? {} : { supportsFileInput: value.supportsFileInput }),
  ...(value.supportsPromptCacheKey === undefined ? {} : { supportsPromptCacheKey: value.supportsPromptCacheKey }),
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

const mergedDefaults = (
  registry: ModelCapabilityDefaults | null,
  provider?: ProviderModelCapabilityObservation,
): ModelCapabilityDefaults => ({
  ...(provider?.capabilities.contextWindow ?? registry?.contextWindow) === undefined
    ? {}
    : { contextWindow: provider?.capabilities.contextWindow ?? registry?.contextWindow },
  ...(provider?.capabilities.maxOutputTokens ?? registry?.maxOutputTokens) === undefined
    ? {}
    : { maxOutputTokens: provider?.capabilities.maxOutputTokens ?? registry?.maxOutputTokens },
  ...(provider?.capabilities.supportsTools ?? registry?.supportsTools) === undefined
    ? {}
    : { supportsTools: provider?.capabilities.supportsTools ?? registry?.supportsTools },
  ...(provider?.capabilities.supportsImageInput ?? registry?.supportsImageInput) === undefined
    ? {}
    : { supportsImageInput: provider?.capabilities.supportsImageInput ?? registry?.supportsImageInput },
  ...(provider?.capabilities.supportsFileInput ?? registry?.supportsFileInput) === undefined
    ? {}
    : { supportsFileInput: provider?.capabilities.supportsFileInput ?? registry?.supportsFileInput },
  ...(provider?.capabilities.supportsPromptCacheKey ?? registry?.supportsPromptCacheKey) === undefined
    ? {}
    : { supportsPromptCacheKey: provider?.capabilities.supportsPromptCacheKey ?? registry?.supportsPromptCacheKey },
  ...(provider?.capabilities.reasoning ?? registry?.reasoning) === undefined
    ? {}
    : { reasoning: cloneReasoning(provider?.capabilities.reasoning ?? registry?.reasoning)! },
});

const conflictingCapabilityFields = (
  registry: ModelCapabilityDefaults | null,
  provider: ProviderModelCapabilityObservation | undefined,
  overrides: ModelCapabilityOverrides,
): ModelCapabilityField[] => {
  const conflicts: ModelCapabilityField[] = [];
  const primitiveFields = [
    'contextWindow',
    'maxOutputTokens',
    'supportsTools',
    'supportsImageInput',
    'supportsFileInput',
    'supportsPromptCacheKey',
  ] as const;
  for (const field of primitiveFields) {
    const values = [registry?.[field], provider?.capabilities[field], overrides[field]].filter(
      (value) => value !== undefined,
    );
    if (new Set(values).size > 1) conflicts.push(field);
  }
  const reasoningValues = [registry?.reasoning, provider?.capabilities.reasoning, overrides.reasoning]
    .filter((value) => value !== undefined)
    .map((value) => JSON.stringify(value));
  if (new Set(reasoningValues).size > 1) conflicts.push('reasoning');
  return conflicts;
};

export const deriveCapabilityOverrides = (
  modelId: string,
  capability: {
    contextWindow: number;
    maxOutputTokens: number;
    supportsTools: boolean;
    supportsImageInput?: boolean;
    supportsFileInput?: boolean;
    supportsPromptCacheKey?: boolean;
    reasoningEfforts?: ReasoningEffort[];
    defaultReasoningEffort?: ReasoningEffort;
    reasoningMandatory?: boolean;
  },
  providerCapabilities?: ProviderModelCapabilityObservation,
): ModelCapabilityOverrides => {
  const baseline = mergedDefaults(resolveModelCapabilityDefaults(modelId), providerCapabilities);
  const overrides: ModelCapabilityOverrides = {};
  if (baseline.contextWindow !== capability.contextWindow) overrides.contextWindow = capability.contextWindow;
  if (baseline.maxOutputTokens !== capability.maxOutputTokens) overrides.maxOutputTokens = capability.maxOutputTokens;
  if (baseline.supportsTools !== capability.supportsTools) overrides.supportsTools = capability.supportsTools;
  if (
    capability.supportsImageInput !== undefined &&
    (baseline.supportsImageInput ?? false) !== capability.supportsImageInput
  ) {
    overrides.supportsImageInput = capability.supportsImageInput;
  }
  if (
    capability.supportsFileInput !== undefined &&
    (baseline.supportsFileInput ?? false) !== capability.supportsFileInput
  ) {
    overrides.supportsFileInput = capability.supportsFileInput;
  }
  if (
    capability.supportsPromptCacheKey !== undefined &&
    (baseline.supportsPromptCacheKey ?? false) !== capability.supportsPromptCacheKey
  ) {
    overrides.supportsPromptCacheKey = capability.supportsPromptCacheKey;
  }

  const defaultReasoning = baseline.reasoning;
  if (capability.reasoningEfforts?.length) {
    const differs =
      !sameEfforts(capability.reasoningEfforts, defaultReasoning?.supportedEfforts) ||
      capability.defaultReasoningEffort !== defaultReasoning?.defaultEffort ||
      capability.reasoningMandatory !== defaultReasoning?.mandatory;
    if (differs) {
      overrides.reasoning = {
        supportedEfforts: [...capability.reasoningEfforts],
        ...(capability.defaultReasoningEffort === undefined
          ? {}
          : { defaultEffort: capability.defaultReasoningEffort }),
        ...(capability.reasoningMandatory === undefined ? {} : { mandatory: capability.reasoningMandatory }),
      };
    }
  }
  return overrides;
};

export const resolveProviderModelConfig = (
  model: PersistedProviderModelConfig,
  providerCapabilities?: ProviderModelCapabilityObservation,
): ProviderModelConfig => {
  const registryDefaults = resolveModelCapabilityDefaults(model.id);
  const providerDefaults = mergedDefaults(registryDefaults, providerCapabilities);
  const overrides = model.capabilityOverrides ?? {};
  const contextWindow = overrides.contextWindow ?? providerDefaults.contextWindow;
  const maxOutputTokens = overrides.maxOutputTokens ?? providerDefaults.maxOutputTokens;
  const supportsTools = overrides.supportsTools ?? providerDefaults.supportsTools;
  const supportsImageInput = overrides.supportsImageInput ?? providerDefaults.supportsImageInput ?? false;
  const supportsFileInput = overrides.supportsFileInput ?? providerDefaults.supportsFileInput ?? false;
  const supportsPromptCacheKey = overrides.supportsPromptCacheKey ?? providerDefaults.supportsPromptCacheKey ?? false;
  if (!contextWindow || !maxOutputTokens || supportsTools === undefined) throw new Error('MODEL_CAPABILITY_INCOMPLETE');
  if (maxOutputTokens > contextWindow) throw new Error('MODEL_CAPABILITY_INVALID');

  const sourceFor = (field: Exclude<ModelCapabilityField, 'reasoning'>): ModelCapabilitySource | undefined =>
    overrides[field] !== undefined
      ? 'manual'
      : providerCapabilities?.capabilities[field] !== undefined
        ? 'provider'
        : registryDefaults?.[field] !== undefined
          ? 'registry'
          : undefined;
  const reasoning = overrides.reasoning ?? providerDefaults.reasoning;
  const reasoningSource: ModelCapabilitySource | undefined = overrides.reasoning
    ? 'manual'
    : providerCapabilities?.capabilities.reasoning
      ? 'provider'
      : registryDefaults?.reasoning
        ? 'registry'
        : undefined;
  const conflicts = conflictingCapabilityFields(registryDefaults, providerCapabilities, overrides);
  return {
    id: model.id,
    contextWindow,
    maxOutputTokens,
    supportsTools,
    supportsImageInput,
    supportsFileInput,
    supportsPromptCacheKey,
    capabilitySources: {
      contextWindow: sourceFor('contextWindow')!,
      maxOutputTokens: sourceFor('maxOutputTokens')!,
      supportsTools: sourceFor('supportsTools')!,
      ...(sourceFor('supportsImageInput') ? { supportsImageInput: sourceFor('supportsImageInput')! } : {}),
      ...(sourceFor('supportsFileInput') ? { supportsFileInput: sourceFor('supportsFileInput')! } : {}),
      ...(sourceFor('supportsPromptCacheKey')
        ? { supportsPromptCacheKey: sourceFor('supportsPromptCacheKey')! }
        : {}),
      ...(reasoningSource === undefined ? {} : { reasoning: reasoningSource }),
    },
    ...(registryDefaults ? { registryDefaults } : {}),
    ...(providerCapabilities ? { providerCapabilities } : {}),
    ...(conflicts.length ? { capabilityConflicts: conflicts } : {}),
    ...(Object.keys(overrides).length ? { capabilityOverrides: overrides } : {}),
    ...(reasoning
      ? {
          reasoningEfforts: [...reasoning.supportedEfforts],
          ...(reasoning.defaultEffort === undefined ? {} : { defaultReasoningEffort: reasoning.defaultEffort }),
          ...(reasoningSource === undefined ? {} : { reasoningSource }),
          ...(reasoning.mandatory === undefined ? {} : { reasoningMandatory: reasoning.mandatory }),
        }
      : {}),
  };
};

export const snapshotProviderModelCapabilities = (model: ProviderModelConfig): ModelCapabilitySnapshot => ({
  contextWindow: model.contextWindow,
  maxOutputTokens: model.maxOutputTokens,
  supportsTools: model.supportsTools,
  supportsImageInput: model.supportsImageInput,
  supportsFileInput: model.supportsFileInput,
  supportsPromptCacheKey: model.supportsPromptCacheKey,
  ...(model.reasoningEfforts === undefined ? {} : { reasoningEfforts: [...model.reasoningEfforts] }),
  ...(model.defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort: model.defaultReasoningEffort }),
  ...(model.reasoningMandatory === undefined ? {} : { reasoningMandatory: model.reasoningMandatory }),
});

export const applyModelCapabilitySnapshot = (
  model: ProviderModelConfig,
  snapshot: ModelCapabilitySnapshot | undefined,
): ProviderModelConfig => {
  if (!snapshot) return model;
  const {
    reasoningEfforts: _reasoningEfforts,
    defaultReasoningEffort: _defaultReasoningEffort,
    reasoningMandatory: _reasoningMandatory,
    reasoningSource: _reasoningSource,
    ...base
  } = model;
  return {
    ...base,
    contextWindow: snapshot.contextWindow,
    maxOutputTokens: snapshot.maxOutputTokens,
    supportsTools: snapshot.supportsTools,
    supportsImageInput: snapshot.supportsImageInput,
    supportsFileInput: snapshot.supportsFileInput,
    supportsPromptCacheKey: snapshot.supportsPromptCacheKey ?? false,
    ...(snapshot.reasoningEfforts === undefined ? {} : { reasoningEfforts: [...snapshot.reasoningEfforts] }),
    ...(snapshot.defaultReasoningEffort === undefined
      ? {}
      : { defaultReasoningEffort: snapshot.defaultReasoningEffort }),
    ...(snapshot.reasoningMandatory === undefined ? {} : { reasoningMandatory: snapshot.reasoningMandatory }),
  };
};
