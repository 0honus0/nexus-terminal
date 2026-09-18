import { AGENT_MODEL_CAPABILITIES, type AgentModelCapability, type ModelCapabilitySnapshot } from './model.types';

export const LEGACY_BASELINE_MODEL_CAPABILITIES = ['streaming'] as const;

const capabilitySet = new Set<string>(AGENT_MODEL_CAPABILITIES);
const legacyBaselineSet = new Set<string>(LEGACY_BASELINE_MODEL_CAPABILITIES);

export const normalizeRequiredModelCapabilities = (
  values: readonly string[],
): AgentModelCapability[] | null => {
  const normalized: AgentModelCapability[] = [];
  for (const value of values) {
    if (legacyBaselineSet.has(value)) continue;
    if (!capabilitySet.has(value)) return null;
    normalized.push(value as AgentModelCapability);
  }
  return normalized;
};

export const missingRequiredModelCapabilities = (
  requirements: readonly AgentModelCapability[],
  capabilities: ModelCapabilitySnapshot,
): AgentModelCapability[] =>
  requirements.filter((requirement) => {
    switch (requirement) {
      case 'tools':
        return !capabilities.supportsTools;
      case 'image_input':
        return !capabilities.supportsImageInput;
      case 'file_input':
        return !capabilities.supportsFileInput;
      case 'reasoning':
        return !capabilities.reasoningEfforts?.some((effort) => effort !== 'none');
    }
  });
