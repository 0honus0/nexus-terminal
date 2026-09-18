import type { JsonValue } from '../agent.types';

export type OpenAiCompatibleProtocol = 'chat-completions' | 'responses';
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const MODEL_FINISH_REASONS = ['stop', 'length', 'content-filter', 'tool-calls', 'error', 'other'] as const;
export type ModelFinishReason = (typeof MODEL_FINISH_REASONS)[number];
export type ReasoningCapabilitySource = 'provider' | 'registry' | 'manual';
export const AGENT_MODEL_CAPABILITIES = ['tools', 'image_input', 'file_input', 'reasoning'] as const;
export type AgentModelCapability = (typeof AGENT_MODEL_CAPABILITIES)[number];
export type ModelCapabilitySource = 'registry' | 'provider' | 'manual';
export type ModelCapabilityField =
  | 'contextWindow'
  | 'maxOutputTokens'
  | 'supportsTools'
  | 'supportsImageInput'
  | 'supportsFileInput'
  | 'supportsPromptCacheKey'
  | 'reasoning';

export interface ModelReasoningDefaults {
  supportedEfforts: ReasoningEffort[];
  defaultEffort?: ReasoningEffort;
  mandatory?: boolean;
}

export interface ModelCapabilityDefaults {
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  supportsImageInput?: boolean;
  supportsFileInput?: boolean;
  supportsPromptCacheKey?: boolean;
  reasoning?: ModelReasoningDefaults;
}

export interface ModelCapabilityOverrides {
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  supportsImageInput?: boolean;
  supportsFileInput?: boolean;
  supportsPromptCacheKey?: boolean;
  reasoning?: ModelReasoningDefaults;
}

export interface ProviderModelCapabilityReport {
  source: string;
  sourceVersion: string;
  capabilities: ModelCapabilityDefaults;
}

export interface ProviderModelCapabilityObservation extends ProviderModelCapabilityReport {
  modelId: string;
  updatedAt: number;
}

export interface ModelCapabilitySnapshot {
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsImageInput: boolean;
  supportsFileInput: boolean;
  supportsPromptCacheKey?: boolean;
  reasoningEfforts?: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
  reasoningMandatory?: boolean;
}

export interface PersistedProviderModelConfig {
  id: string;
  capabilityOverrides?: ModelCapabilityOverrides;
}

export interface ProviderModelConfig {
  id: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsImageInput: boolean;
  supportsFileInput: boolean;
  supportsPromptCacheKey?: boolean;
  capabilitySources: {
    contextWindow: ModelCapabilitySource;
    maxOutputTokens: ModelCapabilitySource;
    supportsTools: ModelCapabilitySource;
    supportsImageInput?: ModelCapabilitySource;
    supportsFileInput?: ModelCapabilitySource;
    supportsPromptCacheKey?: ModelCapabilitySource;
    reasoning?: ModelCapabilitySource;
  };
  registryDefaults?: ModelCapabilityDefaults;
  providerCapabilities?: ProviderModelCapabilityObservation;
  capabilityConflicts?: ModelCapabilityField[];
  capabilityOverrides?: ModelCapabilityOverrides;
  reasoningEfforts?: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
  reasoningSource?: ReasoningCapabilitySource;
  reasoningMandatory?: boolean;
}

export interface PersistedProviderView {
  id: string;
  kind: 'openai-compatible';
  displayName: string;
  baseUrl: string;
  protocol: OpenAiCompatibleProtocol;
  hasCredential: boolean;
  credentialRevision: number;
  models: PersistedProviderModelConfig[];
  liveCapabilities: ProviderModelCapabilityObservation[];
  enabled: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderView {
  id: string;
  kind: 'openai-compatible';
  displayName: string;
  baseUrl: string;
  protocol: OpenAiCompatibleProtocol;
  hasCredential: boolean;
  credentialRevision: number;
  models: ProviderModelConfig[];
  enabled: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderInput {
  kind: 'openai-compatible';
  displayName: string;
  baseUrl: string;
  protocol: OpenAiCompatibleProtocol;
  credential?: string;
  clearCredential?: boolean;
  models: ProviderModelConfig[];
  enabled: boolean;
}

export interface ModelRef {
  providerId: string;
  modelId: string;
  configurationVersion: number;
}

export interface ModelToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface ModelProviderContinuation {
  schemaVersion: 1;
  providerId: string;
  modelId: string;
  configurationVersion: number;
  protocol: OpenAiCompatibleProtocol;
  format: string;
  data: JsonValue;
}

export type ModelContentPart =
  | { type: 'image'; artifactId: string; mediaType: string; dataBase64: string; sha256: string }
  | { type: 'file'; artifactId: string; mediaType: string; filename: string; dataBase64: string; sha256: string };

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  contentParts?: ModelContentPart[];
  toolCallId?: string;
  toolCalls?: ModelToolCall[];
  providerContinuation?: ModelProviderContinuation;
}

export interface ModelToolSchema {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface ModelCacheHint {
  scopeKey: string;
  affinityKey?: string;
  lineageKey?: string;
}

export interface ModelRequest {
  userId: number;
  providerId: string;
  modelId: string;
  configurationVersion: number;
  instructions?: string[];
  messages: ModelMessage[];
  tools?: ModelToolSchema[];
  toolMode?: 'auto' | 'none';
  cache?: ModelCacheHint;
  reasoningEffort?: ReasoningEffort;
  capabilitySnapshot?: ModelCapabilitySnapshot;
  maxOutputTokens: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export interface ProviderTestResult {
  ok: boolean;
  latencyMs: number;
  usage?: TokenUsage;
  errorCode?: string;
}

export interface DiscoveredProviderModel {
  id: string;
  ownedBy?: string;
  createdAt?: number;
  registryDefaults?: ModelCapabilityDefaults;
  providerCapabilities?: ProviderModelCapabilityObservation;
  liveCapabilityReport?: ProviderModelCapabilityReport;
}

export type ModelEvent =
  | { type: 'message.delta'; text: string }
  | { type: 'tool.delta'; index: number; id?: string; name?: string; argumentsDelta?: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'continuation'; continuation: ModelProviderContinuation }
  | { type: 'completed'; finishReason: ModelFinishReason };
