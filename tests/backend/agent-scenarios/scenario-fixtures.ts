import type { ClockPort, Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import type { ModelContinuationRepositoryPort } from '../../../packages/backend/src/modules/agent/ai/model-continuation.repository.port';
import type { RunDefinitionSnapshot } from '../../../packages/backend/src/modules/agent/runtime/runs/run.types';

export const SCENARIO_MODEL_CAPABILITIES: RunDefinitionSnapshot['modelCapabilities'] = {
  contextWindow: 65_536,
  maxOutputTokens: 8_192,
  supportsTools: true,
  supportsImageInput: true,
  supportsFileInput: true,
};

export const scenarioDelegationModel = (modelRefJson: string): string =>
  JSON.stringify({
    ...(JSON.parse(modelRefJson) as Record<string, unknown>),
    modelCapabilities: SCENARIO_MODEL_CAPABILITIES,
  });

export const scope: Scope = { userId: 1, appId: 'scenario-app' };

export const clock: ClockPort = { nowUnixSeconds: () => 1_800_000_000 };

export const emptyModelContinuations: ModelContinuationRepositoryPort = {
  load: async () => [],
};
