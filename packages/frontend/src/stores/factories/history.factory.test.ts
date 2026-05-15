import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { createHistoryStore, type HistoryStoreConfig } from './history.factory';

// Mock logger
const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/utils/log', () => ({ log: mockLog }));

// Mock apiClient
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();

vi.mock('../../utils/apiClient', () => ({
  default: {
    get: mockGet,
    post: mockPost,
    delete: mockDelete,
  },
}));

// Mock errorExtractor
vi.mock('../../utils/errorExtractor', () => ({
  extractErrorMessage: vi.fn((err: unknown, fallback: string) => {
    const apiErr = err as { response?: { data?: { error?: string } }; message?: string };
    return apiErr?.response?.data?.error || apiErr?.message || fallback;
  }),
}));

// Mock uiNotificationsStore
const mockShowError = vi.fn();
const mockShowSuccess = vi.fn();

vi.mock('../uiNotifications.store', () => ({
  useUiNotificationsStore: () => ({
    showError: mockShowError,
    showSuccess: mockShowSuccess,
  }),
}));

// Mock localStorage
const mockLocalStorage = {
  data: {} as Record<string, string>,
  getItem: vi.fn((key: string) => mockLocalStorage.data[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    mockLocalStorage.data[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete mockLocalStorage.data[key];
  }),
  clear: vi.fn(() => {
    mockLocalStorage.data = {};
  }),
  length: 0,
  key: vi.fn(),
};

// 辅助工厂配置
const commandHistoryConfig: HistoryStoreConfig = {
  storeId: 'testCommandHistory',
  apiEndpoint: '/test-command-history',
  itemLabel: 'command',
  addLabel: '命令',
  deleteLabel: '历史记录',
  clearLabel: '所有历史记录',
  cacheKey: 'testCommandHistoryCache',
  reverseOrder: true,
};

const pathHistoryConfig: HistoryStoreConfig = {
  storeId: 'testPathHistory',
  apiEndpoint: '/test-path-history',
  itemLabel: 'path',
  addLabel: '路径',
  deleteLabel: '路径历史',
  clearLabel: '所有路径历史',
  cacheKey: 'testPathHistoryCache',
  reverseOrder: false,
};

describe('createHistoryStore 工厂函数', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockLocalStorage.data = {};
    vi.stubGlobal('localStorage', mockLocalStorage);
  });

  describe('初始状态', () => {
    it('应该创建具有正确初始状态的 store', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      expect(store.historyList).toEqual([]);
      expect(store.searchTerm).toBe('');
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.selectedIndex).toBe(-1);
    });

    it('filteredHistory 在无搜索词时应返回全部列表', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      store.historyList = [
        { id: 1, command: 'ls', timestamp: 1000 },
        { id: 2, command: 'pwd', timestamp: 2000 },
      ] as any;

      expect(store.filteredHistory).toHaveLength(2);
    });
  });

  describe('filteredHistory 计算属性', () => {
    it('应该根据 itemLabel 过滤条目（不区分大小写）', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      store.historyList = [
        { id: 1, command: 'git status', timestamp: 1000 },
        { id: 2, command: 'npm install', timestamp: 2000 },
        { id: 3, command: 'git push', timestamp: 3000 },
      ] as any;

      store.searchTerm = 'git';
      expect(store.filteredHistory).toHaveLength(2);
      expect((store.filteredHistory[0] as any).command).toBe('git status');
      expect((store.filteredHistory[1] as any).command).toBe('git push');
    });

    it('搜索词应自动忽略前后空格', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      store.historyList = [
        { id: 1, command: 'ls -la', timestamp: 1000 },
        { id: 2, command: 'pwd', timestamp: 2000 },
      ] as any;

      store.searchTerm = '  ls  ';
      expect(store.filteredHistory).toHaveLength(1);
    });

    it('path 类型 store 应按 path 字段过滤', () => {
      const useStore = createHistoryStore(pathHistoryConfig);
      const store = useStore();

      store.historyList = [
        { id: 1, path: '/home/user', timestamp: 1000 },
        { id: 2, path: '/var/log', timestamp: 2000 },
      ] as any;

      store.searchTerm = 'home';
      expect(store.filteredHistory).toHaveLength(1);
      expect((store.filteredHistory[0] as any).path).toBe('/home/user');
    });

    it('非字符串类型字段不应被过滤', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      // 条目只有 id 和 timestamp（没有 command 字段）
      store.historyList = [{ id: 1, timestamp: 1000 }] as any;
      store.searchTerm = 'anything';

      expect(store.filteredHistory).toHaveLength(0);
    });
  });

  describe('selectNext（selectNextCommand/selectNextPath 别名）', () => {
    it('空列表时 selectedIndex 应为 -1', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      store.selectNext();
      expect(store.selectedIndex).toBe(-1);
    });

    it('应该从 -1 前进到 0', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      store.historyList = [
        { id: 1, command: 'cmd1', timestamp: 1000 },
        { id: 2, command: 'cmd2', timestamp: 2000 },
      ] as any;

      store.selectNext();
      expect(store.selectedIndex).toBe(0);
    });

    it('应该从最后一条循环回到第一条', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      store.historyList = [
        { id: 1, command: 'cmd1', timestamp: 1000 },
        { id: 2, command: 'cmd2', timestamp: 2000 },
        { id: 3, command: 'cmd3', timestamp: 3000 },
      ] as any;
      store.selectedIndex = 2;

      store.selectNext();
      expect(store.selectedIndex).toBe(0);
    });

    it('selectNextCommand 别名应与 selectNext 行为一致', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      store.historyList = [{ id: 1, command: 'cmd1', timestamp: 1000 }] as any;

      store.selectNextCommand();
      expect(store.selectedIndex).toBe(0);
    });

    it('selectNextPath 别名应与 selectNext 行为一致', () => {
      const useStore = createHistoryStore(pathHistoryConfig);
      const store = useStore();

      store.historyList = [{ id: 1, path: '/home', timestamp: 1000 }] as any;

      store.selectNextPath();
      expect(store.selectedIndex).toBe(0);
    });
  });

  describe('selectPrevious（selectPreviousCommand/selectPreviousPath 别名）', () => {
    it('空列表时 selectedIndex 应为 -1', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      store.selectPrevious();
      expect(store.selectedIndex).toBe(-1);
    });

    it('当 selectedIndex 为 -1 时应跳到最后一条（新行为）', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      store.historyList = [
        { id: 1, command: 'cmd1', timestamp: 1000 },
        { id: 2, command: 'cmd2', timestamp: 2000 },
        { id: 3, command: 'cmd3', timestamp: 3000 },
      ] as any;
      store.selectedIndex = -1;

      store.selectPrevious();
      expect(store.selectedIndex).toBe(2);
    });

    it('从 0 回退应循环到最后一条', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      store.historyList = [
        { id: 1, command: 'cmd1', timestamp: 1000 },
        { id: 2, command: 'cmd2', timestamp: 2000 },
        { id: 3, command: 'cmd3', timestamp: 3000 },
      ] as any;
      store.selectedIndex = 0;

      store.selectPrevious();
      expect(store.selectedIndex).toBe(2);
    });

    it('正常向前回退', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      store.historyList = [
        { id: 1, command: 'cmd1', timestamp: 1000 },
        { id: 2, command: 'cmd2', timestamp: 2000 },
        { id: 3, command: 'cmd3', timestamp: 3000 },
      ] as any;
      store.selectedIndex = 2;

      store.selectPrevious();
      expect(store.selectedIndex).toBe(1);
    });

    it('selectPreviousCommand 别名应与 selectPrevious 行为一致', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      store.historyList = [
        { id: 1, command: 'cmd1', timestamp: 1000 },
        { id: 2, command: 'cmd2', timestamp: 2000 },
      ] as any;
      store.selectedIndex = -1;

      store.selectPreviousCommand();
      expect(store.selectedIndex).toBe(1);
    });

    it('selectPreviousPath 别名应与 selectPrevious 行为一致', () => {
      const useStore = createHistoryStore(pathHistoryConfig);
      const store = useStore();

      store.historyList = [
        { id: 1, path: '/a', timestamp: 1000 },
        { id: 2, path: '/b', timestamp: 2000 },
      ] as any;
      store.selectedIndex = -1;

      store.selectPreviousPath();
      expect(store.selectedIndex).toBe(1);
    });
  });

  describe('resetSelection', () => {
    it('应该将 selectedIndex 重置为 -1', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      store.selectedIndex = 3;
      store.resetSelection();
      expect(store.selectedIndex).toBe(-1);
    });

    it('已经为 -1 时调用不应抛出', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      store.selectedIndex = -1;
      expect(() => store.resetSelection()).not.toThrow();
    });
  });

  describe('setSearchTerm', () => {
    it('应该正确设置搜索词', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      store.setSearchTerm('git');
      expect(store.searchTerm).toBe('git');
    });

    it('设置搜索词时应重置 selectedIndex 为 -1', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      store.selectedIndex = 2;
      store.setSearchTerm('new');
      expect(store.selectedIndex).toBe(-1);
    });
  });

  describe('fetchHistory（reverseOrder=true）', () => {
    it('成功获取时应翻转后端数据（降序）', async () => {
      mockGet.mockResolvedValueOnce({
        data: [
          { id: 1, command: 'first', timestamp: 1000 },
          { id: 2, command: 'second', timestamp: 2000 },
          { id: 3, command: 'third', timestamp: 3000 },
        ],
      });

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      await store.fetchHistory();

      expect(store.historyList).toHaveLength(3);
      expect((store.historyList[0] as any).command).toBe('third');
      expect((store.historyList[2] as any).command).toBe('first');
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('应使用正确的 API 端点', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      await store.fetchHistory();

      expect(mockGet).toHaveBeenCalledWith('/test-command-history');
    });

    it('有缓存时应先加载缓存', async () => {
      const cachedData = [{ id: 1, command: 'cached', timestamp: 1000 }];
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(cachedData));
      mockGet.mockResolvedValueOnce({ data: [{ id: 1, command: 'cached', timestamp: 1000 }] });

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      await store.fetchHistory();

      expect(store.historyList).toHaveLength(1);
    });

    it('服务器数据变化时应更新缓存', async () => {
      const oldData = [{ id: 1, command: 'old', timestamp: 1000 }];
      mockLocalStorage.data['testCommandHistoryCache'] = JSON.stringify(oldData);
      mockLocalStorage.getItem.mockImplementation(
        (key: string) => mockLocalStorage.data[key] ?? null
      );

      const newData = [{ id: 2, command: 'new', timestamp: 2000 }];
      mockGet.mockResolvedValueOnce({ data: [...newData].reverse() });

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      await store.fetchHistory();

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'testCommandHistoryCache',
        expect.any(String)
      );
    });

    it('服务器数据与当前相同时不更新缓存', async () => {
      const data = [{ id: 1, command: 'same', timestamp: 1000 }];
      mockGet.mockResolvedValueOnce({ data: [...data].reverse() });

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      store.historyList = [...data] as any;

      await store.fetchHistory();

      expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
    });

    it('缓存解析失败时应移除缓存并继续', async () => {
      mockLocalStorage.getItem.mockReturnValue('invalid json');
      mockGet.mockResolvedValueOnce({ data: [] });

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      await store.fetchHistory();

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('testCommandHistoryCache');
    });

    it('请求失败时应设置 error 并显示通知', async () => {
      mockGet.mockRejectedValueOnce(new Error('网络错误'));

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      await store.fetchHistory();

      expect(store.error).toBeTruthy();
      expect(mockShowError).toHaveBeenCalledTimes(1);
      expect(store.isLoading).toBe(false);
    });
  });

  describe('fetchHistory（reverseOrder=false）', () => {
    it('应保持后端返回数据的顺序', async () => {
      mockGet.mockResolvedValueOnce({
        data: [
          { id: 1, path: '/first', timestamp: 1000 },
          { id: 2, path: '/second', timestamp: 2000 },
          { id: 3, path: '/third', timestamp: 3000 },
        ],
      });

      const useStore = createHistoryStore(pathHistoryConfig);
      const store = useStore();
      await store.fetchHistory();

      expect(store.historyList).toHaveLength(3);
      expect((store.historyList[0] as any).path).toBe('/first');
      expect((store.historyList[2] as any).path).toBe('/third');
    });
  });

  describe('addItem（addCommand/addPath 别名）', () => {
    it('成功添加后应清除缓存并刷新列表', async () => {
      mockPost.mockResolvedValueOnce({});
      mockGet.mockResolvedValueOnce({ data: [{ id: 1, command: 'new cmd', timestamp: 1000 }] });

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      await store.addItem('new cmd');

      expect(mockPost).toHaveBeenCalledWith('/test-command-history', { command: 'new cmd' });
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('testCommandHistoryCache');
    });

    it('空字符串不应发送请求', async () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      await store.addItem('');

      expect(mockPost).not.toHaveBeenCalled();
    });

    it('纯空白字符串不应发送请求', async () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      await store.addItem('   ');

      expect(mockPost).not.toHaveBeenCalled();
    });

    it('Ctrl+C 信号（\\x03）不应添加', async () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      await store.addItem('\x03');

      expect(mockPost).not.toHaveBeenCalled();
    });

    it('命令应自动去除前后空格', async () => {
      mockPost.mockResolvedValueOnce({});
      mockGet.mockResolvedValueOnce({ data: [] });

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      await store.addItem('  ls -la  ');

      expect(mockPost).toHaveBeenCalledWith('/test-command-history', { command: 'ls -la' });
    });

    it('path 类型应使用 path 作为字段名', async () => {
      mockPost.mockResolvedValueOnce({});
      mockGet.mockResolvedValueOnce({ data: [] });

      const useStore = createHistoryStore(pathHistoryConfig);
      const store = useStore();
      await store.addItem('/home/user');

      expect(mockPost).toHaveBeenCalledWith('/test-path-history', { path: '/home/user' });
    });

    it('添加失败时应显示错误通知', async () => {
      mockPost.mockRejectedValueOnce(new Error('添加失败'));

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      await store.addItem('failing cmd');

      expect(mockShowError).toHaveBeenCalledTimes(1);
    });

    it('addCommand 别名应与 addItem 行为一致', async () => {
      mockPost.mockResolvedValueOnce({});
      mockGet.mockResolvedValueOnce({ data: [] });

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      await store.addCommand('cmd');

      expect(mockPost).toHaveBeenCalledWith('/test-command-history', { command: 'cmd' });
    });

    it('addPath 别名应与 addItem 行为一致', async () => {
      mockPost.mockResolvedValueOnce({});
      mockGet.mockResolvedValueOnce({ data: [] });

      const useStore = createHistoryStore(pathHistoryConfig);
      const store = useStore();
      await store.addPath('/some/path');

      expect(mockPost).toHaveBeenCalledWith('/test-path-history', { path: '/some/path' });
    });
  });

  describe('deleteItem（deleteCommand/deletePath 别名）', () => {
    it('成功删除后应从本地列表移除并显示成功通知', async () => {
      mockDelete.mockResolvedValueOnce({});

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      store.historyList = [
        { id: 1, command: 'keep', timestamp: 1000 },
        { id: 2, command: 'delete me', timestamp: 2000 },
        { id: 3, command: 'keep too', timestamp: 3000 },
      ] as any;

      await store.deleteItem(2);

      expect(mockDelete).toHaveBeenCalledWith('/test-command-history/2');
      expect(store.historyList).toHaveLength(2);
      expect(store.historyList.find((e) => e.id === 2)).toBeUndefined();
      expect(mockShowSuccess).toHaveBeenCalledWith('历史记录已删除');
    });

    it('删除失败时应显示错误通知', async () => {
      mockDelete.mockRejectedValueOnce(new Error('删除失败'));

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      store.historyList = [{ id: 1, command: 'test', timestamp: 1000 }] as any;

      await store.deleteItem(1);

      expect(mockShowError).toHaveBeenCalledTimes(1);
      expect(store.historyList).toHaveLength(1); // 失败时不移除
    });

    it('删除后应清除缓存', async () => {
      mockDelete.mockResolvedValueOnce({});

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      store.historyList = [{ id: 1, command: 'test', timestamp: 1000 }] as any;

      await store.deleteItem(1);

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('testCommandHistoryCache');
    });

    it('deleteCommand 别名应使用正确的通知消息', async () => {
      mockDelete.mockResolvedValueOnce({});

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      store.historyList = [{ id: 1, command: 'test', timestamp: 1000 }] as any;

      await store.deleteCommand(1);
      expect(mockShowSuccess).toHaveBeenCalledWith('历史记录已删除');
    });

    it('path 类型 deleteLabel 应正确反映在成功消息中', async () => {
      mockDelete.mockResolvedValueOnce({});

      const useStore = createHistoryStore(pathHistoryConfig);
      const store = useStore();
      store.historyList = [{ id: 1, path: '/test', timestamp: 1000 }] as any;

      await store.deletePath(1);
      expect(mockShowSuccess).toHaveBeenCalledWith('路径历史已删除');
    });
  });

  describe('clearAll（clearAllHistory 别名）', () => {
    it('成功清空后 historyList 应为空并显示成功通知', async () => {
      mockDelete.mockResolvedValueOnce({});

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      store.historyList = [{ id: 1, command: 'test', timestamp: 1000 }] as any;

      await store.clearAll();

      expect(mockDelete).toHaveBeenCalledWith('/test-command-history');
      expect(store.historyList).toEqual([]);
      expect(mockShowSuccess).toHaveBeenCalledWith('所有历史记录已清空');
    });

    it('清空失败时应显示错误通知', async () => {
      mockDelete.mockRejectedValueOnce(new Error('清空失败'));

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      await store.clearAll();

      expect(mockShowError).toHaveBeenCalledTimes(1);
    });

    it('清空后应清除缓存', async () => {
      mockDelete.mockResolvedValueOnce({});

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      await store.clearAll();

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('testCommandHistoryCache');
    });

    it('clearAllHistory 别名应使用正确的成功消息', async () => {
      mockDelete.mockResolvedValueOnce({});

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      await store.clearAllHistory();

      expect(mockShowSuccess).toHaveBeenCalledWith('所有历史记录已清空');
    });
  });

  describe('配置选项验证', () => {
    it('两个不同 storeId 的实例应各自独立', () => {
      const useCmdStore = createHistoryStore(commandHistoryConfig);
      const usePathStore = createHistoryStore(pathHistoryConfig);

      const cmdStore = useCmdStore();
      const pathStore = usePathStore();

      cmdStore.historyList = [{ id: 1, command: 'cmd', timestamp: 1000 }] as any;
      pathStore.historyList = [{ id: 2, path: '/path', timestamp: 2000 }] as any;

      expect(cmdStore.historyList).toHaveLength(1);
      expect(pathStore.historyList).toHaveLength(1);
      // 两个 store 的数据不共享
      expect((cmdStore.historyList[0] as any).command).toBe('cmd');
      expect((pathStore.historyList[0] as any).path).toBe('/path');
    });

    it('同一 storeId 的多个实例应共享状态', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store1 = useStore();
      const store2 = useStore();

      store1.historyList = [{ id: 1, command: 'shared', timestamp: 1000 }] as any;
      expect(store2.historyList).toHaveLength(1);
    });

    it('reverseOrder 默认为 true', async () => {
      const configWithoutReverse: HistoryStoreConfig = {
        storeId: 'testDefaultReverse',
        apiEndpoint: '/test-default',
        itemLabel: 'command',
        addLabel: '命令',
        deleteLabel: '历史记录',
        clearLabel: '所有历史记录',
        cacheKey: 'testDefaultCache',
        // reverseOrder 未指定，默认为 true
      };

      mockGet.mockResolvedValueOnce({
        data: [
          { id: 1, command: 'first', timestamp: 1000 },
          { id: 2, command: 'second', timestamp: 2000 },
        ],
      });

      const useStore = createHistoryStore(configWithoutReverse);
      const store = useStore();
      await store.fetchHistory();

      // 默认 reverseOrder=true，数据被翻转
      expect((store.historyList[0] as any).command).toBe('second');
      expect((store.historyList[1] as any).command).toBe('first');
    });
  });

  describe('边界条件', () => {
    it('空列表时 selectNext 后 selectPrevious 应保持 -1', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      store.selectNext();
      expect(store.selectedIndex).toBe(-1);

      store.selectPrevious();
      expect(store.selectedIndex).toBe(-1);
    });

    it('fetchHistory 返回空数组时 historyList 应为空', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      await store.fetchHistory();

      expect(store.historyList).toEqual([]);
      expect(store.isLoading).toBe(false);
    });

    it('fetchHistory 成功后应清除之前的 error', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      store.error = '旧错误';
      await store.fetchHistory();

      expect(store.error).toBeNull();
    });

    it('selectPrevious 和 selectNext 应基于过滤后的列表计算索引', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      store.historyList = [
        { id: 1, command: 'git status', timestamp: 1000 },
        { id: 2, command: 'npm install', timestamp: 2000 },
        { id: 3, command: 'git push', timestamp: 3000 },
      ] as any;
      store.searchTerm = 'git'; // 只有 2 条匹配

      store.selectNext();
      expect(store.selectedIndex).toBe(0);

      store.selectNext();
      expect(store.selectedIndex).toBe(1);

      // 循环回到 0
      store.selectNext();
      expect(store.selectedIndex).toBe(0);
    });

    it('搜索过滤为空时 selectPrevious 应保持 -1', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      store.historyList = [{ id: 1, command: 'git status', timestamp: 1000 }] as any;
      store.searchTerm = 'no match';

      store.selectPrevious();
      expect(store.selectedIndex).toBe(-1);
    });

    it('单条历史记录时 selectPrevious 从 -1 应选中该条', () => {
      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();

      store.historyList = [{ id: 1, command: 'only', timestamp: 1000 }] as any;
      store.selectedIndex = -1;

      store.selectPrevious();
      expect(store.selectedIndex).toBe(0);
    });

    it('isLoading 在操作完成后应始终为 false（成功路径）', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      await store.fetchHistory();

      expect(store.isLoading).toBe(false);
    });

    it('isLoading 在操作完成后应始终为 false（失败路径）', async () => {
      mockGet.mockRejectedValueOnce(new Error('fail'));

      const useStore = createHistoryStore(commandHistoryConfig);
      const store = useStore();
      await store.fetchHistory();

      expect(store.isLoading).toBe(false);
    });
  });
});