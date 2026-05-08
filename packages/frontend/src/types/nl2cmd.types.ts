/**
 * NL2CMD (Natural Language to Command) 前端类型定义
 */

// AI Provider 类型
export type AIProvider = 'openai' | 'claude';

// OpenAI API 端点路径（用户可自定义，如 /v1/chat/completions, /v2/responses）
export type OpenAIEndpoint = string;

// AI Provider 配置
export interface AISettings {
  enabled: boolean;
  provider: AIProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  openaiEndpoint?: OpenAIEndpoint;
  rateLimitEnabled?: boolean; // 是否启用速率限制（默认 true）
  streamingEnabled?: boolean; // 是否启用流式响应（默认 false）
}

// NL2CMD 请求
export interface NL2CMDRequest {
  query: string;
  osType?: string;
  shellType?: string;
  currentPath?: string;
}

// NL2CMD 响应
export interface NL2CMDResponse {
  success: boolean;
  command?: string;
  explanation?: string;
  warning?: string;
  error?: string;
  streaming?: boolean; // 是否为流式响应
}

// AI 配置获取响应
export interface AISettingsResponse {
  success: boolean;
  settings: AISettings;
  message?: string;
}

// AI 连接测试响应
export interface AITestResponse {
  success: boolean;
  message?: string;
}
