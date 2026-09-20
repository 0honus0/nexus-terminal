import { AGENT_MODEL_CAPABILITIES, type AgentModelCapability, type ModelCapabilitySnapshot } from './model.types';

const capabilitySet = new Set<string>(AGENT_MODEL_CAPABILITIES);

export const normalizeRequiredModelCapabilities = (values: readonly string[]): AgentModelCapability[] | null => {
  if (values.some((value) => !capabilitySet.has(value))) return null;
  return values as AgentModelCapability[];
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
