import type { ModelCapabilityDefaults } from './model.types';
import {
  createModelCapabilityRegistryIndex,
  matchModelCapabilityRegistry,
  type ModelCapabilityRegistryIndex,
  type ModelCapabilityRegistryMatch,
} from './model-capability-matcher';
import type { ModelCapabilityRegistrySnapshot } from './model-capability-registry-source';

let runtimeSnapshot: ModelCapabilityRegistrySnapshot | null = null;
let runtimeIndex: ModelCapabilityRegistryIndex | null = null;

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

export const installRuntimeModelCapabilityRegistry = (snapshot: ModelCapabilityRegistrySnapshot | null): void => {
  runtimeSnapshot = snapshot;
  runtimeIndex = snapshot ? createModelCapabilityRegistryIndex(snapshot.entries) : null;
};

export const modelCapabilityRegistryMatch = (modelId: string): ModelCapabilityRegistryMatch | null => {
  const match = runtimeIndex ? matchModelCapabilityRegistry(modelId, runtimeIndex) : null;
  return match ? { ...match, defaults: cloneDefaults(match.defaults) } : null;
};

export const modelCapabilityRegistryRuntimeStatus = () =>
  runtimeSnapshot
    ? {
        entryCount: Object.keys(runtimeSnapshot.entries).length,
        generatedAt: runtimeSnapshot.generatedAt,
        sourceRevision: runtimeSnapshot.sourceRevision,
      }
    : null;
