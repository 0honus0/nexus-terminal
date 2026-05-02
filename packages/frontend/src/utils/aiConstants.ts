/**
 * AI Provider 默认配置常量
 * 集中管理 AI 相关的默认值，避免硬编码散落在多处
 */

/** OpenAI API 默认 Base URL */
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com';

/** AI Provider 默认配置 */
export const AI_PROVIDER_DEFAULTS = {
  openai: {
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    model: 'gpt-4o-mini',
    endpoint: 'chat/completions',
  },
} as const;
