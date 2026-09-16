export type OpenAiCompatibleProtocol = 'chat-completions' | 'responses';
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ReasoningCapabilitySource = 'provider' | 'registry' | 'manual';
export type ModelCapabilitySource = 'registry' | 'manual';

export interface ModelReasoningDefaults {
  supportedEfforts: ReasoningEffort[];
  defaultEffort?: ReasoningEffort;
  mandatory?: boolean;
  supportsMaxTokens?: boolean;
}

export interface ModelCapabilityDefaults {
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  reasoning?: ModelReasoningDefaults;
}

export interface ModelCapabilityOverrides {
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  reasoning?: ModelReasoningDefaults;
}

export interface PersistedProviderModelConfig {
  id: string;
  capabilityOverrides?: ModelCapabilityOverrides;
  // Legacy flat capability fields are read-only compatibility for existing models_json rows.
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  reasoningEfforts?: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
  reasoningMandatory?: boolean;
  reasoningSupportsMaxTokens?: boolean;
}

export interface ProviderModelConfig {
  id: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  capabilitySources: {
    contextWindow: ModelCapabilitySource;
    maxOutputTokens: ModelCapabilitySource;
    supportsTools: ModelCapabilitySource;
    reasoning?: ModelCapabilitySource;
  };
  registryDefaults?: ModelCapabilityDefaults;
  capabilityOverrides?: ModelCapabilityOverrides;
  reasoningEfforts?: ReasoningEffort[];
  defaultReasoningEffort?: ReasoningEffort;
  reasoningSource?: ReasoningCapabilitySource;
  reasoningMandatory?: boolean;
  reasoningSupportsMaxTokens?: boolean;
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

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ModelToolCall[];
}

export interface ModelToolSchema {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface ModelCacheHint {
  scopeKey: string;
  affinityKey?: string;
}

export interface ModelRequest {
  userId: number;
  providerId: string;
  modelId: string;
  instructions?: string[];
  messages: ModelMessage[];
  tools?: ModelToolSchema[];
  toolMode?: 'auto' | 'none';
  cache?: ModelCacheHint;
  reasoningEffort?: ReasoningEffort;
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
}

export type ModelEvent =
  | { type: 'message.delta'; text: string }
  | { type: 'tool.delta'; index: number; id?: string; name?: string; argumentsDelta?: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'completed'; finishReason: string | null };
