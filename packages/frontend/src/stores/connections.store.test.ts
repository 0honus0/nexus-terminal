import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useConnectionsStore, type ConnectionInfo } from './connections.store';
import apiClient from '../utils/apiClient';
import { cacheManager, CACHE_KEYS, CACHE_CONFIG } from '../utils/cacheManager';

vi.mock('../utils/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('connections.store', () => {
  let localStorageMock: Record<string, string> = {};
  const connectionCacheOptions = CACHE_CONFIG[CACHE_KEYS.CONNECTIONS];

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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockConnections: ConnectionInfo[] = [
    {
      id: 1,
      name: '测试服务器 1',
      type: 'SSH',
      host: '192.168.1.100',
      port: 22,
      username: 'root',
      auth_method: 'password',
      created_at: Date.now(),
      updated_at: Date.now(),
      last_connected_at: null,
    },
    {
      id: 2,
      name: '测试服务器 2',
      type: 'SSH',
      host: '192.168.1.101',
      port: 22,
      username: 'admin',
      auth_method: 'key',
      ssh_key_id: 1,
      tag_ids: [1, 2],
      created_at: Date.now(),
      updated_at: Date.now(),
      last_connected_at: Date.now(),
      notes: '测试备注',
    },
  ];

  describe('初始状态', () => {
    it('应该有正确的初始状态', () => {
      const store = useConnectionsStore();

      expect(store.connections).toEqual([]);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe('fetchConnections', () => {
    it('无缓存时应从后端加载连接列表', async () => {
      const store = useConnectionsStore();

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockConnections });

      await store.fetchConnections();

      expect(store.connections).toEqual(mockConnections);
      expect(store.isLoading).toBe(false);
      expect(cacheManager.get(CACHE_KEYS.CONNECTIONS, [], connectionCacheOptions)).toEqual(
        mockConnections
      );
    });

    it('有缓存时应先显示缓存再后台更新', async () => {
      const store = useConnectionsStore();
      const cachedData = mockConnections.slice(0, 1);

      cacheManager.set(CACHE_KEYS.CONNECTIONS, cachedData, connectionCacheOptions);

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockConnections });

      await store.fetchConnections();

      expect(store.connections).toEqual(mockConnections);
    });

    it('后端数据与缓存相同时不更新', async () => {
      const store = useConnectionsStore();

      cacheManager.set(CACHE_KEYS.CONNECTIONS, mockConnections, connectionCacheOptions);

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockConnections });

      await store.fetchConnections();

      expect(store.connections).toEqual(mockConnections);
    });

    it('获取失败时应保留缓存数据并设置错误', async () => {
      const store = useConnectionsStore();
      const cachedData = mockConnections.slice(0, 1);

      cacheManager.set(CACHE_KEYS.CONNECTIONS, cachedData, connectionCacheOptions);

      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { data: { message: '网络错误' } },
      });

      await store.fetchConnections();

      expect(store.connections).toEqual(cachedData);
      expect(store.error).toBe('网络错误');
    });

    it('未授权时应记录警告', async () => {
      const store = useConnectionsStore();
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { status: 401, data: { message: 'Unauthorized' } },
      });

      await store.fetchConnections();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('未授权，需要登录才能获取连接列表')
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('addConnection', () => {
    it('添加连接成功应清除缓存并重新获取', async () => {
      const store = useConnectionsStore();

      const newConnectionData = {
        name: '新服务器',
        type: 'SSH' as const,
        host: '192.168.1.102',
        port: 22,
        username: 'user',
        auth_method: 'password' as const,
        password: 'pass',
        tag_ids: [1],
      };

      const createdConnection: ConnectionInfo = {
        id: 3,
        ...newConnectionData,
        created_at: Date.now(),
        updated_at: Date.now(),
        last_connected_at: null,
      };

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: '添加成功', connection: createdConnection },
      });

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: [...mockConnections, createdConnection],
      });

      const result = await store.addConnection(newConnectionData);

      expect(result).toBe(true);
      expect(apiClient.post).toHaveBeenCalledWith('/connections', newConnectionData);
      expect(cacheManager.get(CACHE_KEYS.CONNECTIONS, [], connectionCacheOptions)).toEqual([
        ...mockConnections,
        createdConnection,
      ]);
    });

    it('添加失败应设置错误', async () => {
      const store = useConnectionsStore();

      vi.mocked(apiClient.post).mockRejectedValueOnce({
        response: { data: { message: '连接名称已存在' } },
      });

      const result = await store.addConnection({
        name: '重复名称',
        type: 'SSH',
        host: '192.168.1.1',
        port: 22,
        username: 'root',
        auth_method: 'password',
      });

      expect(result).toBe(false);
      expect(store.error).toBe('连接名称已存在');
    });
  });

  describe('updateConnection', () => {
    it('更新连接成功应更新本地列表并清除缓存', async () => {
      const store = useConnectionsStore();
      store.connections = [...mockConnections];

      const updatedConnection: ConnectionInfo = {
        ...mockConnections[0],
        name: '更新后的名称',
        port: 2222,
      };

      vi.mocked(apiClient.put).mockResolvedValueOnce({
        data: { message: '更新成功', connection: updatedConnection },
      });

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: [updatedConnection, mockConnections[1]],
      });

      const result = await store.updateConnection(1, {
        name: '更新后的名称',
        port: 2222,
      });

      expect(result).toBe(true);
      expect(apiClient.put).toHaveBeenCalledWith('/connections/1', {
        name: '更新后的名称',
        port: 2222,
      });
    });

    it('更新失败应设置错误', async () => {
      const store = useConnectionsStore();

      vi.mocked(apiClient.put).mockRejectedValueOnce({
        response: { data: { message: '更新失败' } },
      });

      const result = await store.updateConnection(1, { name: '新名称' });

      expect(result).toBe(false);
      expect(store.error).toBe('更新失败');
    });
  });

  describe('deleteConnection', () => {
    it('删除连接成功应从列表中移除并清除缓存', async () => {
      const store = useConnectionsStore();
      store.connections = [...mockConnections];

      vi.mocked(apiClient.delete).mockResolvedValueOnce({});

      const result = await store.deleteConnection(1);

      expect(result).toBe(true);
      expect(store.connections).toHaveLength(1);
      expect(store.connections[0].id).toBe(2);
      expect(cacheManager.has(CACHE_KEYS.CONNECTIONS, connectionCacheOptions)).toBe(false);
    });

    it('删除失败应设置错误', async () => {
      const store = useConnectionsStore();
      store.connections = [...mockConnections];

      vi.mocked(apiClient.delete).mockRejectedValueOnce({
        response: { data: { message: '删除失败' } },
      });

      const result = await store.deleteConnection(1);

      expect(result).toBe(false);
      expect(store.error).toBe('删除失败');
      expect(store.connections).toHaveLength(2); // 不应改变
    });
  });

  describe('deleteBatchConnections', () => {
    it('批量删除成功应返回 true', async () => {
      const store = useConnectionsStore();
      store.connections = [...mockConnections];

      vi.mocked(apiClient.delete).mockResolvedValue({});

      const result = await store.deleteBatchConnections([1, 2]);

      expect(result).toBe(true);
      expect(apiClient.delete).toHaveBeenCalledTimes(2);
    });

    it('部分删除失败应返回 false 并设置汇总错误', async () => {
      const store = useConnectionsStore();
      store.connections = [...mockConnections];

      vi.mocked(apiClient.delete)
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce({ response: { data: { message: '删除失败' } } });

      const result = await store.deleteBatchConnections([1, 2]);

      expect(result).toBe(false);
      expect(store.error).toContain('批量删除操作中部分连接未能成功删除');
    });

    it('空 ID 列表应直接返回 true', async () => {
      const store = useConnectionsStore();

      const result = await store.deleteBatchConnections([]);

      expect(result).toBe(true);
      expect(apiClient.delete).not.toHaveBeenCalled();
    });
  });

  describe('testConnection', () => {
    it('测试连接成功应返回结果', async () => {
      const store = useConnectionsStore();

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { success: true, message: '连接成功', latency: 123 },
      });

      const result = await store.testConnection(1);

      expect(result).toEqual({ success: true, message: '连接成功', latency: 123 });
      expect(apiClient.post).toHaveBeenCalledWith('/connections/1/test');
    });

    it('测试失败应返回错误消息', async () => {
      const store = useConnectionsStore();

      vi.mocked(apiClient.post).mockRejectedValueOnce({
        response: { data: { message: '连接超时' } },
      });

      const result = await store.testConnection(1);

      expect(result).toEqual({ success: false, message: '连接超时' });
    });
  });

  describe('cloneConnection', () => {
    it('克隆连接成功应刷新列表', async () => {
      const store = useConnectionsStore();

      vi.mocked(apiClient.post).mockResolvedValueOnce({});
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockConnections });

      const result = await store.cloneConnection(1, '克隆连接');

      expect(result).toBe(true);
      expect(apiClient.post).toHaveBeenCalledWith('/connections/1/clone', { name: '克隆连接' });
    });
  });

  describe('addTagToConnectionsAction', () => {
    it('为多个连接添加标签应调用批量 API', async () => {
      const store = useConnectionsStore();

      vi.mocked(apiClient.post).mockResolvedValueOnce({});
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockConnections });

      const result = await store.addTagToConnectionsAction([1, 2], 3);

      expect(result).toBe(true);
      expect(apiClient.post).toHaveBeenCalledWith('/connections/add-tag', {
        connection_ids: [1, 2],
        tag_id: 3,
      });
    });

    it('空连接列表应直接返回 true', async () => {
      const store = useConnectionsStore();

      const result = await store.addTagToConnectionsAction([], 1);

      expect(result).toBe(true);
      expect(apiClient.post).not.toHaveBeenCalled();
    });
  });

  describe('updateConnectionTags', () => {
    it('更新连接标签应刷新列表', async () => {
      const store = useConnectionsStore();

      vi.mocked(apiClient.put).mockResolvedValueOnce({});
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockConnections });

      const result = await store.updateConnectionTags(1, [1, 2, 3]);

      expect(result).toBe(true);
      expect(apiClient.put).toHaveBeenCalledWith('/connections/1/tags', { tag_ids: [1, 2, 3] });
    });
  });

  describe('getVncSessionToken', () => {
    it('获取 VNC 会话令牌成功应返回 token', async () => {
      const store = useConnectionsStore();

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { token: 'vnc-token-123' },
      });

      const token = await store.getVncSessionToken(1, 1024, 768);

      expect(token).toBe('vnc-token-123');
      expect(apiClient.post).toHaveBeenCalledWith(
        '/connections/1/vnc-session?width=1024&height=768'
      );
    });

    it('获取失败应抛出错误', async () => {
      const store = useConnectionsStore();

      vi.mocked(apiClient.post).mockRejectedValueOnce({
        response: { data: { message: '获取令牌失败' } },
      });

      await expect(store.getVncSessionToken(1)).rejects.toThrow();
    });
  });
});
