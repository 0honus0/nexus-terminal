export type AgentApprovalModeDto = 'ask' | 'full_access';
export type AgentContextCompactionModeDto = 'aggressive' | 'balanced' | 'conservative';
export type AgentContextProfileDto = 'normal' | 'extended';
export type AgentAvailabilityStateDto = 'disabled' | 'enabling' | 'enabled' | 'degraded' | 'unavailable';

export interface AgentHardLimitsDto {
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

export interface AgentSettingsDocumentDto {
  schemaVersion: 1;
  feature: { enabled: boolean };
  model: {
    defaultProviderId: string | null;
    defaultModelId: string | null;
    fallbackModels: Array<{ providerId: string; modelId: string }>;
  };
  performance: {
    maxConcurrentRuntimes: number;
    maxConcurrentModelCalls: number | 'auto';
  };
  budget: {
    maxRunSteps: number;
    maxActiveExecutionSeconds: number;
    toolTimeoutSeconds: number;
    maxToolOutputBytes: number;
    maxRecallItems: number;
    maxRecallBytes: number;
  };
  hardLimits: AgentHardLimitsDto;
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

export interface AgentAvailabilityViewDto {
  state: AgentAvailabilityStateDto;
  reason: string | null;
  appId: string | null;
  appHealth: 'disabled' | 'enabling' | 'running' | 'degraded' | 'failed' | 'disabling' | null;
}

export interface AgentSettingsViewDto {
  requestedSettings: AgentSettingsDocumentDto;
  effectiveSettings: AgentSettingsDocumentDto;
  hardLimits: AgentHardLimitsDto;
  runtimeCapabilities: { workspaceRuntimeController: boolean };
  availability: AgentAvailabilityViewDto;
  revision: number;
}

export type AgentSettingsSectionPatchDto<T> = { [K in keyof T]?: T[K] };
export interface AgentSettingsPatchDto {
  feature?: AgentSettingsSectionPatchDto<AgentSettingsDocumentDto['feature']>;
  model?: AgentSettingsSectionPatchDto<AgentSettingsDocumentDto['model']>;
  performance?: AgentSettingsSectionPatchDto<AgentSettingsDocumentDto['performance']>;
  budget?: AgentSettingsSectionPatchDto<AgentSettingsDocumentDto['budget']>;
  subagents?: AgentSettingsSectionPatchDto<AgentSettingsDocumentDto['subagents']>;
  storage?: AgentSettingsSectionPatchDto<AgentSettingsDocumentDto['storage']>;
  workspaceRuntime?: AgentSettingsSectionPatchDto<AgentSettingsDocumentDto['workspaceRuntime']>;
  browser?: AgentSettingsSectionPatchDto<AgentSettingsDocumentDto['browser']>;
  plugins?: AgentSettingsSectionPatchDto<AgentSettingsDocumentDto['plugins']>;
}

export interface AgentSettingsPatchRequestDto {
  patch: AgentSettingsPatchDto;
  expectedVersion: number;
}

export interface AgentHardLimitUsageDto {
  artifactUsedBytes: number;
  artifactReservedBytes: number;
  executingRuntimes: number;
  activeWorkspaces: number;
}

export interface AgentHardLimitChangeDto {
  key: keyof AgentHardLimitsDto;
  current: number | null;
  proposed: number | null;
  direction: 'increase' | 'decrease';
}

export interface AgentHardLimitPreviewRequestDto {
  proposed: Partial<AgentHardLimitsDto>;
  expectedVersion: number;
}

export interface AgentHardLimitPreviewDto {
  confirmationId: string;
  expectedVersion: number;
  current: AgentHardLimitsDto;
  proposed: AgentHardLimitsDto;
  impact: {
    changes: AgentHardLimitChangeDto[];
    hasIncrease: boolean;
    hasDecrease: boolean;
    usage: AgentHardLimitUsageDto;
  };
  expiresAt: number;
  runtimeCapabilities: { workspaceRuntimeController: boolean };
}

export interface AgentHardLimitConfirmRequestDto {
  confirmationId: string;
  expectedVersion: number;
}

export interface AgentAppSummaryDto {
  id: string;
  displayName: string;
  version: string;
  surface: 'builtin' | 'agent' | 'custom' | 'none';
  defaultApprovalMode: AgentApprovalModeDto;
  stateVersion: number;
  enabled: boolean;
  health: 'healthy' | 'degraded' | 'disabled' | 'failed' | 'enabling' | 'disabling';
  healthReason: string | null;
  runningRuns: number;
  pendingApprovals: number;
  pendingBudgetRequests: number;
}

export interface AgentAppStateUpdateRequestDto {
  enabled: boolean;
  expectedVersion: number;
}

export type AgentTargetKindDto = 'workspace' | 'ssh';
export type AgentTargetGrantSelectionDto = { mode: 'all' } | { mode: 'ids'; ids: string[] };
export type AgentCapabilityScopeDto =
  { kind: 'global' } | { kind: 'targets'; targets: Partial<Record<AgentTargetKindDto, AgentTargetGrantSelectionDto>> };

export type AgentCapabilityDto =
  | 'file.read'
  | 'file.write'
  | 'file.delete'
  | 'machine.inspect'
  | 'shell.execute'
  | 'machine.docker.manage'
  | 'workspace.manage'
  | 'browser.read'
  | 'browser.interact'
  | 'integration.mcp.read'
  | 'integration.mcp.invoke'
  | 'integration.acp.invoke'
  | 'artifacts.read'
  | 'app.intents.exchange';

export interface AgentCapabilityDefinitionDto {
  id: AgentCapabilityDto;
  scopeKind: AgentCapabilityScopeDto['kind'];
  supportedTargets: AgentTargetKindDto[];
  defaultScope: AgentCapabilityScopeDto;
}

export interface AgentCapabilityGrantInputDto {
  capability: AgentCapabilityDto;
  scope: AgentCapabilityScopeDto;
}

export interface AgentCapabilityGrantDto extends AgentCapabilityGrantInputDto {
  schemaVersion: 2;
  grantedAt: number;
}

export interface AgentAppGrantViewDto {
  app: AgentAppSummaryDto;
  policyRevision: number;
  capabilityDefinitions: AgentCapabilityDefinitionDto[];
  grants: AgentCapabilityGrantDto[];
}

export interface AgentAppGrantReplaceRequestDto {
  grants: AgentCapabilityGrantInputDto[];
  expectedPolicyRevision: number;
}

export interface AgentExecutionPolicyOverridesDto {
  maxRunSteps?: number;
  maxActiveExecutionSeconds?: number;
  toolTimeoutSeconds?: number;
  maxToolOutputBytes?: number;
  maxRecallItems?: number;
  maxRecallBytes?: number;
  maxSubagentMessages?: number;
  maxSubagentMessageBytes?: number;
  contextCompactionMode?: AgentContextCompactionModeDto;
  contextProfile?: AgentContextProfileDto;
}

export interface AgentExecutionPolicyEffectiveDto {
  maxRunSteps: number;
  maxActiveExecutionSeconds: number;
  toolTimeoutSeconds: number;
  maxToolOutputBytes: number;
  maxRecallItems: number;
  maxRecallBytes: number;
  maxSubagentMessages: number;
  maxSubagentMessageBytes: number;
  contextCompactionMode: AgentContextCompactionModeDto;
  contextProfile: AgentContextProfileDto;
}

export interface AgentExecutionPolicyViewDto {
  overrides: AgentExecutionPolicyOverridesDto;
  effective: AgentExecutionPolicyEffectiveDto;
  version: number;
}

export interface AgentExecutionPolicyReplaceRequestDto {
  overrides: AgentExecutionPolicyOverridesDto;
  expectedVersion: number;
}

export interface AgentHostSummaryDto {
  featureEnabled: boolean;
  hostState: AgentAvailabilityStateDto | 'disabling';
  apps: AgentAppSummaryDto[];
  totalRunningRuns: number;
  totalPendingApprovals: number;
  totalPendingBudgetRequests: number;
  eventCursor: number;
}

export interface AgentRecommendedPluginDto {
  appId: string;
  installed: boolean;
  installedVersion: string | null;
  enabled: boolean;
  availableVersion: string;
  displayName: string;
  description: string;
  catalogUrl: string;
  publisherKeyId: string;
}

export type AgentRecommendedPluginInstallRequestDto = Record<string, never>;

export interface AgentRecommendedPluginInstallResultDto {
  app: AgentAppSummaryDto;
  installedNow: boolean;
}

export interface AgentTargetDenylistEntryDto {
  connectionId: number;
  reason: string;
  changedBy: number;
  changedAt: number;
}

export interface AgentTargetDenylistViewDto {
  revision: number;
  list: AgentTargetDenylistEntryDto[];
}

export interface AgentTargetDenylistReplaceRequestDto {
  connectionIds: number[];
  reason: string;
  expectedRevision: number;
}
