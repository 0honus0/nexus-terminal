import { describe, it, expect, vi, beforeEach } from 'vitest';
import apiClient, { DEFAULT_REQUEST_TIMEOUT_MS, AI_REQUEST_TIMEOUT_MS } from './apiClient';

// Mock authRuntimeBridge
vi.mock('./authRuntimeBridge', () => ({
  handleUnauthorizedLogout: vi.fn(),
}));

describe('apiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应该导出默认请求超时常量', () => {
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(10_000);
  });

  it('应该导出 AI 请求超时常量', () => {
    expect(AI_REQUEST_TIMEOUT_MS).toBe(60_000);
  });

  it('应该创建 axios 实例', () => {
    expect(apiClient).toBeDefined();
    expect(apiClient.defaults.baseURL).toBe('/api/v1');
    expect(apiClient.defaults.timeout).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
  });

  it('应该启用 withCredentials', () => {
    expect(apiClient.defaults.withCredentials).toBe(true);
  });
});
