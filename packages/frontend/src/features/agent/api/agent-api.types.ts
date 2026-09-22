export type { AgentEnvelopeDto as AgentEnvelope } from '@nexus-terminal/protocol/agent-common';
export type { AgentArtifactRefDto as AgentArtifactRef } from '@nexus-terminal/protocol/agent-artifacts';

export interface AgentHardLimits {
  maxRunSteps: number;
  maxActiveExecutionSeconds: number;
  toolTimeoutSeconds: number;
  maxToolOutputBytes: number;
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
}

export interface AgentSettingsDocument {
  schemaVersion: 1;
  feature: { enabled: boolean };
  model: {
    defaultProviderId: string | null;
    defaultModelId: string | null;
    fallbackModels: Array<{ providerId: string; modelId: string }>;
  };
  performance: { maxConcurrentRuntimes: number; maxConcurrentModelCalls: number | 'auto' };
  budget: {
    maxRunSteps: number;
    maxActiveExecutionSeconds: number;
    toolTimeoutSeconds: number;
    maxToolOutputBytes: number;
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
    enabledRecipeIds: string[];
    toolVersions: Record<string, { enabledVersionIds: string[]; defaultVersionId: string | null }>;
    acpProfiles: Array<{ id: string; argv: string[]; cwd: string }>;
  };
  browser: {
    targets: Array<{
      id: string;
      endpoints: Array<{
        scope: 'docker-network' | 'external-network';
        via: 'backend' | 'runner';
        url: string;
        priority: number;
        allowPlaintext: boolean;
        verifyTls: boolean;
      }>;
      allowedUrlPatterns: string[];
    }>;
  };
  plugins: { repositories: Array<{ url: string }> };
}

export type AgentAvailabilityState = 'disabled' | 'enabling' | 'enabled' | 'degraded' | 'unavailable';

export interface AgentAvailabilityView {
  state: AgentAvailabilityState;
  reason: string | null;
  appId: string | null;
  appHealth: 'disabled' | 'enabling' | 'running' | 'degraded' | 'failed' | 'disabling' | null;
}

export interface AgentSettingsView {
  requestedSettings: AgentSettingsDocument;
  effectiveSettings: AgentSettingsDocument;
  hardLimits: AgentHardLimits;
  runtimeCapabilities: { workspaceRuntimeController: boolean };
  availability: AgentAvailabilityView;
  revision: number;
}
