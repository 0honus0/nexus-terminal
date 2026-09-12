export interface ProviderModelConfig {
  id: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  priceMicrosPerMillionInput?: number;
  priceMicrosPerMillionOutput?: number;
  priceVersion?: string;
}

export interface ProviderView {
  id: string;
  kind: 'openai-compatible';
  displayName: string;
  baseUrl: string;
  hasCredential: boolean;
  credentialRevision: number;
  models: ProviderModelConfig[];
  privateHostExceptions: string[];
  enabled: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderInput {
  kind: 'openai-compatible';
  displayName: string;
  baseUrl: string;
  credential?: string;
  clearCredential?: boolean;
  models: ProviderModelConfig[];
  privateHostExceptions: string[];
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

export interface ModelRequest {
  userId: number;
  providerId: string;
  modelId: string;
  messages: ModelMessage[];
  tools?: ModelToolSchema[];
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
}

export type ModelEvent =
  | { type: 'message.delta'; text: string }
  | { type: 'tool.delta'; index: number; id?: string; name?: string; argumentsDelta?: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'completed'; finishReason: string | null };
