import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuditLogStore } from './audit.store';
import apiClient from '../utils/apiClient';
import type { AuditLogEntry, AuditLogApiResponse } from '../types/server.types';

// Mock 依赖
vi.mock('../utils/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('audit.store', () => {
  let localStorageMock: Record<string, string> = {};

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    // Mock localStorage
    localStorageMock = {};
    Object.defineProperty(global, 'localStorage', {
      value: {
        getItem: (key: string) => localStorageMock[key] || null,
        setItem: (key: string, value: string) => {
          localStorageMock[key] = value;
        },
        removeItem: (key: string) => {
          delete localStorageMock[key];
        },
        clear: () => {
          localStorageMock = {};
        },
        get length() {
          return Object.keys(localStorageMock).length;
        },
        key: (index: number) => {
          const keys = Object.keys(localStorageMock);
          return keys[index] || null;
        },
      },
      writable: true,
      configurable: true,
    });
  });

  const mockLogs: AuditLogEntry[] = [
    {
      id: 1,
      timestamp: 1700000000,
      action_type: 'LOGIN_SUCCESS',
      details: { username: 'admin' },
    },
    {
      id: 2,
      timestamp: 1700000060,
      action_type: 'CONNECTION_CREATED',
      details: { connectionName: '测试服务器' },
    },
    {
      id: 3,
      timestamp: 1700000120,
      action_type: 'LOGOUT',
      details: null,
    },
  ];

  const mockApiResponse: AuditLogApiResponse = {
    logs: mockLogs,
    total: 3,
    limit: 50,
    offset: 0,
  };

  describe('初始状态', () => {
    it('应该有正确的初始状态', () => {
      const store = useAuditLogStore();
      expect(store.logs).toEqual([]);
      expect(store.totalLogs).toBe(0);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.currentPage).toBe(1);
      expect(store.logsPerPage).toBe(50);
    });
  });

  describe('fetchLogs', () => {
    it('应从后端获取日志列表', async () => {
      const store = useAuditLogStore();
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockApiResponse });

      await store.fetchLogs();

      expect(apiClient.get).toHaveBeenCalledWith('/audit-logs', {
        params: { limit: 50, offset: 0 },
      });
      expect(store.logs).toEqual(mockLogs);
      expect(store.totalLogs).toBe(3);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('应支持分页参数', async () => {
      const store = useAuditLogStore();
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { logs: mockLogs.slice(0, 1), total: 10, limit: 1, offset: 0 },
      });

      await store.fetchLogs({ page: 1, limit: 1 });

      expect(apiClient.get).toHaveBeenCalledWith('/audit-logs', {
        params: { limit: 1, offset: 0 },
      });
      expect(store.currentPage).toBe(1);
    });

    it('应支持搜索过滤', async () => {
      const store = useAuditLogStore();
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockApiResponse });

      await store.fetchLogs({ searchTerm: 'admin' });

      expect(apiClient.get).toHaveBeenCalledWith('/audit-logs', {
        params: { limit: 50, offset: 0, search: 'admin' },
      });
    });

    it('应支持动作类型过滤', async () => {
      const store = useAuditLogStore();
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockApiResponse });

      await store.fetchLogs({ actionType: 'LOGIN_SUCCESS' });

      expect(apiClient.get).toHaveBeenCalledWith('/audit-logs', {
        params: { limit: 50, offset: 0, action_type: 'LOGIN_SUCCESS' },
      });
    });

    it('应支持排序参数', async () => {
      const store = useAuditLogStore();
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockApiResponse });

      await store.fetchLogs({ sortOrder: 'asc' });

      expect(apiClient.get).toHaveBeenCalledWith('/audit-logs', {
        params: { limit: 50, offset: 0, sort_order: 'asc' },
      });
    });

    it('获取失败时应设置错误并清空日志', async () => {
      const store = useAuditLogStore();
      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { data: { message: '服务器错误' } },
      });

      await store.fetchLogs();

      expect(store.error).toBe('服务器错误');
      expect(store.logs).toEqual([]);
      expect(store.totalLogs).toBe(0);
      expect(store.isLoading).toBe(false);
    });

    it('仪表盘请求失败时应保留缓存数据', async () => {
      const store = useAuditLogStore();
      const cachedLogs = [mockLogs[0]];
      localStorage.setItem('dashboardAuditLogsCache', JSON.stringify(cachedLogs));

      // 先加载缓存
      store.logs = cachedLogs;

      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { status: 502 },
        isAxiosError: true,
      } as any);

      await store.fetchLogs({ isDashboardRequest: true });

      expect(store.error).toBeNull();
      expect(store.logs).toEqual(cachedLogs);
    });

    it('仪表盘请求应使用 localStorage 缓存', async () => {
      const store = useAuditLogStore();
      const cachedLogs = [mockLogs[0]];
      localStorage.setItem('dashboardAuditLogsCache', JSON.stringify(cachedLogs));

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { logs: mockLogs, total: 3 },
      });

      await store.fetchLogs({ isDashboardRequest: true });

      expect(store.logs).toEqual(mockLogs);
    });

    it('非仪表盘请求失败时应清空日志', async () => {
      const store = useAuditLogStore();
      store.logs = mockLogs;

      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { data: { message: '获取失败' } },
      });

      await store.fetchLogs();

      expect(store.logs).toEqual([]);
      expect(store.totalLogs).toBe(0);
    });

    it('仪表盘请求不应更新 totalLogs 和 currentPage', async () => {
      const store = useAuditLogStore();
      store.totalLogs = 100;
      store.currentPage = 5;

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { logs: mockLogs, total: 3 },
      });

      await store.fetchLogs({ isDashboardRequest: true });

      expect(store.totalLogs).toBe(100);
      expect(store.currentPage).toBe(5);
    });
  });

  describe('setLogsPerPage', () => {
    it('应更新每页日志数并重新获取', async () => {
      const store = useAuditLogStore();
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { logs: mockLogs, total: 3, limit: 25, offset: 0 },
      });

      await store.setLogsPerPage(25);

      expect(store.logsPerPage).toBe(25);
      expect(apiClient.get).toHaveBeenCalledWith('/audit-logs', {
        params: { limit: 25, offset: 0 },
      });
    });
  });
});
