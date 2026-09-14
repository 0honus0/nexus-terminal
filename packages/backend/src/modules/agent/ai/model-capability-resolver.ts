import type { ProviderModelConfig, ReasoningCapability, ReasoningEffort } from './model.types';

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

const cloneCapability = (capability: ReasoningCapability): ReasoningCapability => ({
  supportedEfforts: [...capability.supportedEfforts],
  ...(capability.defaultEffort === undefined ? {} : { defaultEffort: capability.defaultEffort }),
  ...(capability.mandatory === undefined ? {} : { mandatory: capability.mandatory }),
  ...(capability.supportsMaxTokens === undefined ? {} : { supportsMaxTokens: capability.supportsMaxTokens }),
  source: capability.source,
});

const registryCapability = (modelId: string): ReasoningCapability | null => {
  const id = modelId.trim().toLowerCase();

  if (/^gpt-5\.6-(?:sol|terra|luna)(?:-\d{4}-\d{2}-\d{2})?$/.test(id) || id === 'gpt-5.6') {
    return {
      supportedEfforts: [...OPENAI_GPT_56_EFFORTS],
      defaultEffort: 'medium',
      source: 'registry',
    };
  }

  if (/^gpt-5\.1(?:-\d{4}-\d{2}-\d{2})?$/.test(id)) {
    return {
      supportedEfforts: [...OPENAI_GPT_51_EFFORTS],
      defaultEffort: 'none',
      source: 'registry',
    };
  }

  if (/^gpt-5-pro(?:-\d{4}-\d{2}-\d{2})?$/.test(id)) {
    return {
      supportedEfforts: ['high'],
      defaultEffort: 'high',
      mandatory: true,
      source: 'registry',
    };
  }

  return null;
};

export const resolveModelReasoningCapability = (
  modelId: string,
  // TODO(P-026/provider-live-capability): intentionally reserved for authoritative Provider metadata.
  // Do not remove this extension point as unused. A later change may feed Provider-specific
  // reasoning capability here (for example an extended models endpoint). Until that work is
  // implemented and validated, the built-in registry remains the only active capability source.
  live?: Omit<ReasoningCapability, 'source'>,
): ReasoningCapability | null => {
  if (live?.supportedEfforts.length) {
    const efforts = live.mandatory
      ? live.supportedEfforts.filter((effort) => effort !== 'none')
      : [...live.supportedEfforts];
    if (efforts.length) {
      return {
        supportedEfforts: efforts,
        ...(live.defaultEffort !== undefined && efforts.includes(live.defaultEffort)
          ? { defaultEffort: live.defaultEffort }
          : {}),
        ...(live.mandatory === undefined ? {} : { mandatory: live.mandatory }),
        ...(live.supportsMaxTokens === undefined ? {} : { supportsMaxTokens: live.supportsMaxTokens }),
        source: 'provider',
      };
    }
  }
  const registered = registryCapability(modelId);
  return registered ? cloneCapability(registered) : null;
};

export const applyReasoningCapability = (
  model: ProviderModelConfig,
  capability: ReasoningCapability | null,
): ProviderModelConfig => {
  const base: ProviderModelConfig = {
    id: model.id,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    supportsTools: model.supportsTools,
    ...(model.priceMicrosPerMillionInput === undefined
      ? {}
      : { priceMicrosPerMillionInput: model.priceMicrosPerMillionInput }),
    ...(model.priceMicrosPerMillionOutput === undefined
      ? {}
      : { priceMicrosPerMillionOutput: model.priceMicrosPerMillionOutput }),
    ...(model.priceVersion === undefined ? {} : { priceVersion: model.priceVersion }),
  };
  if (!capability) return base;
  return {
    ...base,
    reasoningEfforts: [...capability.supportedEfforts],
    ...(capability.defaultEffort === undefined ? {} : { defaultReasoningEffort: capability.defaultEffort }),
    reasoningSource: capability.source,
    ...(capability.mandatory === undefined ? {} : { reasoningMandatory: capability.mandatory }),
    ...(capability.supportsMaxTokens === undefined ? {} : { reasoningSupportsMaxTokens: capability.supportsMaxTokens }),
  };
};
