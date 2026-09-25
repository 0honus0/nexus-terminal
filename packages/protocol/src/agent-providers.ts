export type AgentReasoningEffortDto = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type AgentModelCapabilityDto = 'tools' | 'image_input' | 'file_input' | 'reasoning';
export type AgentModelCapabilitySourceDto = 'registry' | 'provider' | 'manual';
export type AgentReasoningCapabilitySourceDto = 'provider' | 'registry' | 'manual';
export const AGENT_PROVIDER_MODEL_LIMIT = 100;
export type AgentModelCapabilityFieldDto =
  | 'contextWindow'
  | 'maxOutputTokens'
  | 'supportsTools'
  | 'supportsImageInput'
  | 'supportsFileInput'
  | 'supportsPromptCacheKey'
  | 'reasoning';

export interface AgentModelReasoningDefaultsDto {
  supportedEfforts: AgentReasoningEffortDto[];
  defaultEffort?: AgentReasoningEffortDto;
  mandatory?: boolean;
}

export interface AgentModelCapabilityDefaultsDto {
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  supportsImageInput?: boolean;
  supportsFileInput?: boolean;
  supportsPromptCacheKey?: boolean;
  reasoning?: AgentModelReasoningDefaultsDto;
}

export interface AgentModelCapabilityOverridesDto extends AgentModelCapabilityDefaultsDto {}

export interface AgentProviderModelCapabilityReportDto {
  source: string;
  sourceVersion: string;
  capabilities: AgentModelCapabilityDefaultsDto;
}

export interface AgentProviderModelCapabilityObservationDto extends AgentProviderModelCapabilityReportDto {
  modelId: string;
  updatedAt: number;
}

export interface AgentProviderModelInputDto {
  id: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsImageInput?: boolean;
  supportsFileInput?: boolean;
  supportsPromptCacheKey?: boolean;
  reasoningEfforts?: AgentReasoningEffortDto[];
  defaultReasoningEffort?: AgentReasoningEffortDto;
  reasoningMandatory?: boolean;
}

export interface AgentProviderModelDto extends AgentProviderModelInputDto {
  supportsImageInput: boolean;
  supportsFileInput: boolean;
  capabilitySources: {
    contextWindow: AgentModelCapabilitySourceDto;
    maxOutputTokens: AgentModelCapabilitySourceDto;
    supportsTools: AgentModelCapabilitySourceDto;
    supportsImageInput?: AgentModelCapabilitySourceDto;
    supportsFileInput?: AgentModelCapabilitySourceDto;
    supportsPromptCacheKey?: AgentModelCapabilitySourceDto;
    reasoning?: AgentModelCapabilitySourceDto;
  };
  registryDefaults?: AgentModelCapabilityDefaultsDto;
  providerCapabilities?: AgentProviderModelCapabilityObservationDto;
  capabilityConflicts?: AgentModelCapabilityFieldDto[];
  capabilityOverrides?: AgentModelCapabilityOverridesDto;
  reasoningSource?: AgentReasoningCapabilitySourceDto;
}

export type AgentProviderProtocolDto = 'chat-completions' | 'responses';

export interface AgentProviderViewDto {
  id: string;
  kind: 'openai-compatible';
  displayName: string;
  baseUrl: string;
  protocol: AgentProviderProtocolDto;
  hasCredential: boolean;
  credentialRevision: number;
  models: AgentProviderModelDto[];
  enabled: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentProviderCreateRequestDto {
  kind: 'openai-compatible';
  displayName: string;
  baseUrl: string;
  protocol: AgentProviderProtocolDto;
  credential?: string;
  clearCredential?: boolean;
  models: AgentProviderModelInputDto[];
  enabled: boolean;
}

export interface AgentProviderPatchFieldsDto {
  kind?: 'openai-compatible';
  displayName?: string;
  baseUrl?: string;
  protocol?: AgentProviderProtocolDto;
  credential?: string;
  clearCredential?: boolean;
  models?: AgentProviderModelInputDto[];
  enabled?: boolean;
}

export type AgentProviderPatchRequestDto = AgentProviderPatchFieldsDto & {
  expectedVersion: number;
};

export interface AgentProviderDeleteQueryDto {
  expectedVersion: number;
}

export interface AgentProviderDeleteResponseDto {
  deleted: true;
}

export interface AgentTokenUsageDto {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export interface AgentProviderTestRequestDto {
  modelId: string;
}

export interface AgentProviderTestResponseDto {
  ok: boolean;
  latencyMs: number;
  usage?: AgentTokenUsageDto;
  errorCode?: string;
}

export interface AgentDiscoverEndpointModelsRequestDto {
  baseUrl: string;
  credential?: string;
}

export interface AgentDiscoveredProviderModelDto {
  id: string;
  ownedBy?: string;
  createdAt?: number;
  registryDefaults?: AgentModelCapabilityDefaultsDto;
  providerCapabilities?: AgentProviderModelCapabilityObservationDto;
  liveCapabilityReport?: AgentProviderModelCapabilityReportDto;
}

export interface AgentAvailableModelDto {
  providerId: string;
  providerDisplayName: string;
  configurationVersion: number;
  modelId: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  reasoning: {
    supportedEfforts: AgentReasoningEffortDto[];
    defaultEffort: AgentReasoningEffortDto | null;
    source: AgentReasoningCapabilitySourceDto | null;
    mandatory: boolean;
  };
}

export interface AgentModelRegistryStatusDto {
  sourceUrl: string;
  autoUpdate: boolean;
  activeSource: 'builtin' | 'updated';
  entryCount: number;
  generatedAt: number;
  sourceRevision: string | null;
  builtinGeneratedAt: number;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastErrorCode: string | null;
  nextAutoUpdateAt: number | null;
}

export interface AgentModelRegistryResolveQueryDto {
  modelId: string;
}

export interface AgentModelRegistryResolveResponseDto {
  modelId: string;
  defaults: AgentModelCapabilityDefaultsDto | null;
}

export interface AgentModelRegistryUpdateRequestDto {
  autoUpdate: boolean;
}
