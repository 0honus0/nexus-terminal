export interface AgentEnvelope<T> {
  data: T;
  requestId: string;
}

export interface AgentHardLimits {
  maxContextTokens: number;
  maxOutputTokens: number;
  maxRunTokens: number;
  maxRunSteps: number;
  maxRunCostMicros: number | null;
  maxActiveExecutionSeconds: number;
  toolTimeoutSeconds: number;
  maxToolOutputBytes: number;
  maxRawToolBytes: number;
  maxArtifactBytes: number;
  maxSingleArtifactBytes: number;
  maxGlobalArtifactBytes: number;
  maxRecallItems: number;
  maxRecallBytes: number;
  maxConcurrentRuntimes: number;
  maxConcurrentModelCalls: number;
  maxDelegationDepth: number;
  maxSubagentMessagesPerRun: number;
  maxSubagentMessageBytesPerRun: number;
  maxActiveWorkspaces: number;
  unretainedArtifactTtlSeconds: number;
  workspaceIdleTtlSeconds: number;
}

export interface AgentSettingsDocument {
  schemaVersion: 1;
  feature: { enabled: boolean };
  model: { defaultProviderId: string | null; defaultModelId: string | null };
  performance: { maxConcurrentRuntimes: number; maxConcurrentModelCalls: number | 'auto' };
  budget: {
    maxContextTokens: number;
    maxOutputTokens: number;
    maxRunTokens: number;
    maxRunSteps: number;
    maxRunCostMicros: number | null;
    maxActiveExecutionSeconds: number;
    toolTimeoutSeconds: number;
    maxToolOutputBytes: number;
    maxRawToolBytes: number;
    maxRecallItems: number;
    maxRecallBytes: number;
  };
  hardLimits: AgentHardLimits;
  subagents: {
    maxDelegationDepth: number;
    maxSubagentMessagesPerRun: number;
    maxSubagentMessageBytesPerRun: number;
  };
  storage: {
    maxArtifactBytes: number;
    maxSingleArtifactBytes: number;
    maxGlobalArtifactBytes: number;
    unretainedArtifactTtlSeconds: number;
  };
  workspaceRuntime: {
    maxActiveWorkspaces: number;
    workspaceIdleTtlSeconds: number;
    enabledRecipeIds: string[];
    toolVersions: Record<string, { enabledVersionIds: string[]; defaultVersionId: string | null }>;
  };
  safety: { providerPrivateNetworkExceptions: string[] };
}

export interface AgentSettingsView {
  requestedSettings: AgentSettingsDocument;
  effectiveSettings: AgentSettingsDocument;
  hardLimits: AgentHardLimits;
  runtimeCapabilities: { workspaceRuntimeController: boolean };
  availability: { state: string };
  revision: number;
}

export interface AgentArtifactRef {
  id: string;
  appId: string;
  originalName: string;
  mediaType: string;
  sha256: string | null;
  sizeBytes: number;
  status: 'staging' | 'ready' | 'deleting' | 'deleted' | 'unavailable';
  retained: boolean;
  version: number;
  createdAt: number;
  readyAt: number | null;
  expiresAt: number | null;
  deletedAt: number | null;
}
