import { BUILTIN_MODEL_CAPABILITY_REGISTRY } from './model-capability-registry.snapshot';
import type { ModelCapabilityDefaults } from './model.types';
import type { ModelCapabilityRegistrySnapshot } from './model-capability-registry-source';

let runtimeSnapshot: ModelCapabilityRegistrySnapshot | null = null;

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
};

export const modelCapabilityRegistryDefaults = (modelId: string): ModelCapabilityDefaults | null => {
  const id = modelId.trim().toLowerCase();
  const builtinEntries = BUILTIN_MODEL_CAPABILITY_REGISTRY.entries as Readonly<Record<string, ModelCapabilityDefaults>>;
  const value = runtimeSnapshot?.entries[id] ?? builtinEntries[id];
  return value ? cloneDefaults(value) : null;
};

export const modelCapabilityRegistryBuiltinStatus = () => ({
  entryCount: Object.keys(BUILTIN_MODEL_CAPABILITY_REGISTRY.entries).length,
  generatedAt: BUILTIN_MODEL_CAPABILITY_REGISTRY.generatedAt,
  sourceRevision: BUILTIN_MODEL_CAPABILITY_REGISTRY.sourceRevision,
});

export const modelCapabilityRegistryRuntimeStatus = () =>
  runtimeSnapshot
    ? {
        entryCount: Object.keys(runtimeSnapshot.entries).length,
        generatedAt: runtimeSnapshot.generatedAt,
        sourceRevision: runtimeSnapshot.sourceRevision,
      }
    : null;
