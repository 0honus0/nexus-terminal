import { BUILTIN_MODEL_CAPABILITY_REGISTRY } from '../data/model-capability-registry.snapshot';
import type { ModelCapabilityDefaults } from './model.types';
import {
  createModelCapabilityRegistryIndex,
  matchModelCapabilityRegistry,
  type ModelCapabilityRegistryIndex,
  type ModelCapabilityRegistryMatch,
} from './model-capability-matcher';
import type { ModelCapabilityRegistrySnapshot } from './model-capability-registry-source';

const builtinEntries = BUILTIN_MODEL_CAPABILITY_REGISTRY.entries as Readonly<Record<string, ModelCapabilityDefaults>>;
const builtinIndex = createModelCapabilityRegistryIndex(builtinEntries);
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
  const match =
    (runtimeIndex ? matchModelCapabilityRegistry(modelId, runtimeIndex) : null) ??
    matchModelCapabilityRegistry(modelId, builtinIndex);
  return match ? { ...match, defaults: cloneDefaults(match.defaults) } : null;
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
