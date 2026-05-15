import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { createTagStore, type TagStoreConfig, type TagInfo } from './tag.factory';

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
const mockPut = vi.fn();
const mockDelete = vi.fn();

vi.mock('../../utils/apiClient', () => ({
  default: {
    get: mockGet,
    post: mockPost,
    put: mockPut,
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
const tagsConfig: TagStoreConfig = {
  storeId: 'testTags',
  apiEndpoint: '/test-tags',
  cacheKey: 'testTagsCache',
  useNotifications: false,
};

const quickCommandTagsConfig: TagStoreConfig = {
  storeId: 'testQuickCommandTags',
  apiEndpoint: '/test-quick-command-tags',
  cacheKey: 'testQuickCommandTagsCache',
  useNotifications: true,
};

// 辅助：创建模拟标签数据
const createMockTag = (overrides: Partial<TagInfo> = {}): TagInfo => ({
  id: overrides.id ?? 1,
  name: overrides.name ?? '测试标签',
  created_at: overrides.created_at ?? Date.now(),
  updated_at: overrides.updated_at ?? Date.now(),
});

describe('createTagStore 工厂函数', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockLocalStorage.data = {};
    vi.stubGlobal('localStorage', mockLocalStorage);
  });

  describe('初始状态', () => {
    it('应该创建具有正确初始状态的 store', () => {
      const useStore = createTagStore(tagsConfig);
      const store = useStore();

      expect(store.tags).toEqual([]);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe('fetchTags', () => {
    it('无缓存时应从 API 获取标签列表', async () => {
      const mockTags = [createMockTag({ id: 1, name: '标签1' }), createMockTag({ id: 2, name: '标签2' })];
      mockGet.mockResolvedValueOnce({ data: mockTags });

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      const result = await store.fetchTags();

      expect(result).toBe(true);
      expect(store.tags).toEqual(mockTags);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(mockGet).toHaveBeenCalledWith('/test-tags');
    });

    it('有缓存时应先加载缓存，再从 API 更新', async () => {
      const cachedTags = [createMockTag({ id: 1, name: '缓存标签' })];
      mockLocalStorage.data['testTagsCache'] = JSON.stringify(cachedTags);
      mockLocalStorage.getItem.mockImplementation(
        (key: string) => mockLocalStorage.data[key] ?? null
      );

      const freshTags = [createMockTag({ id: 1, name: '最新标签' }), createMockTag({ id: 2, name: '新标签' })];
      mockGet.mockResolvedValueOnce({ data: freshTags });

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      const result = await store.fetchTags();

      expect(result).toBe(true);
      expect(store.tags).toEqual(freshTags);
    });

    it('API 数据与缓存相同时不应更新缓存', async () => {
      const tags = [createMockTag({ id: 1, name: '相同标签' })];
      mockLocalStorage.data['testTagsCache'] = JSON.stringify(tags);
      mockLocalStorage.getItem.mockImplementation(
        (key: string) => mockLocalStorage.data[key] ?? null
      );
      mockGet.mockResolvedValueOnce({ data: tags });

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      await store.fetchTags();

      expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
    });

    it('缓存解析失败时应清除缓存并从 API 加载', async () => {
      mockLocalStorage.getItem.mockReturnValue('invalid json');
      const freshTags = [createMockTag({ id: 1, name: '新标签' })];
      mockGet.mockResolvedValueOnce({ data: freshTags });

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      const result = await store.fetchTags();

      expect(result).toBe(true);
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('testTagsCache');
      expect(store.tags).toEqual(freshTags);
    });

    it('API 请求失败时应设置错误状态并返回 false', async () => {
      mockGet.mockRejectedValueOnce(new Error('网络错误'));

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      const result = await store.fetchTags();

      expect(result).toBe(false);
      expect(store.error).toBe('网络错误');
      expect(store.isLoading).toBe(false);
    });

    it('成功后应缓存数据到 localStorage', async () => {
      const freshTags = [createMockTag({ id: 1, name: '标签' })];
      mockGet.mockResolvedValueOnce({ data: freshTags });

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      await store.fetchTags();

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'testTagsCache',
        JSON.stringify(freshTags)
      );
    });
  });

  describe('fetchTags - useNotifications 配置', () => {
    it('useNotifications=false 时 API 失败不应显示通知', async () => {
      mockGet.mockRejectedValueOnce(new Error('错误'));

      const useStore = createTagStore(tagsConfig); // useNotifications=false
      const store = useStore();
      await store.fetchTags();

      expect(mockShowError).not.toHaveBeenCalled();
    });

    it('useNotifications=true 时 API 失败应显示错误通知', async () => {
      mockGet.mockRejectedValueOnce(new Error('网络错误'));

      const useStore = createTagStore(quickCommandTagsConfig); // useNotifications=true
      const store = useStore();
      await store.fetchTags();

      expect(mockShowError).toHaveBeenCalledTimes(1);
    });
  });

  describe('addTag', () => {
    it('成功添加标签后应清除缓存、刷新列表并返回新标签', async () => {
      const newTag = createMockTag({ id: 3, name: '新标签' });
      mockPost.mockResolvedValueOnce({ data: { message: 'ok', tag: newTag } });
      mockGet.mockResolvedValueOnce({ data: [newTag] });

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      const result = await store.addTag('新标签');

      expect(result).toEqual(newTag);
      expect(mockPost).toHaveBeenCalledWith('/test-tags', { name: '新标签' });
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('testTagsCache');
      expect(store.isLoading).toBe(false);
    });

    it('添加失败时应返回 null 并设置错误状态', async () => {
      mockPost.mockRejectedValueOnce(new Error('添加失败'));

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      const result = await store.addTag('失败标签');

      expect(result).toBeNull();
      expect(store.error).toBe('添加失败');
      expect(store.isLoading).toBe(false);
    });

    it('useNotifications=true 时成功添加应显示成功通知', async () => {
      const newTag = createMockTag({ id: 1 });
      mockPost.mockResolvedValueOnce({ data: { message: 'ok', tag: newTag } });
      mockGet.mockResolvedValueOnce({ data: [newTag] });

      const useStore = createTagStore(quickCommandTagsConfig); // useNotifications=true
      const store = useStore();
      await store.addTag('新标签');

      expect(mockShowSuccess).toHaveBeenCalledWith('标签已添加');
    });

    it('useNotifications=false 时成功添加不应显示通知', async () => {
      const newTag = createMockTag({ id: 1 });
      mockPost.mockResolvedValueOnce({ data: { message: 'ok', tag: newTag } });
      mockGet.mockResolvedValueOnce({ data: [newTag] });

      const useStore = createTagStore(tagsConfig); // useNotifications=false
      const store = useStore();
      await store.addTag('新标签');

      expect(mockShowSuccess).not.toHaveBeenCalled();
    });

    it('useNotifications=true 时失败添加应显示错误通知', async () => {
      mockPost.mockRejectedValueOnce(new Error('失败'));

      const useStore = createTagStore(quickCommandTagsConfig); // useNotifications=true
      const store = useStore();
      await store.addTag('失败标签');

      expect(mockShowError).toHaveBeenCalledTimes(1);
    });

    it('useNotifications=false 时失败添加不应显示错误通知', async () => {
      mockPost.mockRejectedValueOnce(new Error('失败'));

      const useStore = createTagStore(tagsConfig); // useNotifications=false
      const store = useStore();
      await store.addTag('失败标签');

      expect(mockShowError).not.toHaveBeenCalled();
    });

    it('fetchTags 成功但 useNotifications=false 时不应显示成功通知', async () => {
      const newTag = createMockTag({ id: 1 });
      mockPost.mockResolvedValueOnce({ data: { message: 'ok', tag: newTag } });
      // fetchTags 返回 false (失败)，但 useNotifications=true 才显示成功
      mockGet.mockResolvedValueOnce({ data: [] });

      const useStore = createTagStore(tagsConfig); // useNotifications=false
      const store = useStore();
      await store.addTag('标签');

      expect(mockShowSuccess).not.toHaveBeenCalled();
    });
  });

  describe('updateTag', () => {
    it('成功更新标签后应清除缓存并刷新列表', async () => {
      mockPut.mockResolvedValueOnce({});
      const updatedTags = [createMockTag({ id: 1, name: '已更新' })];
      mockGet.mockResolvedValueOnce({ data: updatedTags });

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      const result = await store.updateTag(1, '已更新');

      expect(result).toBe(true);
      expect(mockPut).toHaveBeenCalledWith('/test-tags/1', { name: '已更新' });
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('testTagsCache');
      expect(store.isLoading).toBe(false);
    });

    it('更新失败时应返回 false 并设置错误状态', async () => {
      mockPut.mockRejectedValueOnce(new Error('更新失败'));

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      const result = await store.updateTag(1, '失败标签');

      expect(result).toBe(false);
      expect(store.error).toBe('更新失败');
      expect(store.isLoading).toBe(false);
    });

    it('useNotifications=true 时成功更新应显示成功通知', async () => {
      mockPut.mockResolvedValueOnce({});
      mockGet.mockResolvedValueOnce({ data: [] });

      const useStore = createTagStore(quickCommandTagsConfig);
      const store = useStore();
      await store.updateTag(1, '更新');

      expect(mockShowSuccess).toHaveBeenCalledWith('标签已更新');
    });

    it('useNotifications=false 时成功更新不应显示通知', async () => {
      mockPut.mockResolvedValueOnce({});
      mockGet.mockResolvedValueOnce({ data: [] });

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      await store.updateTag(1, '更新');

      expect(mockShowSuccess).not.toHaveBeenCalled();
    });

    it('useNotifications=true 时失败更新应显示错误通知', async () => {
      mockPut.mockRejectedValueOnce(new Error('失败'));

      const useStore = createTagStore(quickCommandTagsConfig);
      const store = useStore();
      await store.updateTag(1, '标签');

      expect(mockShowError).toHaveBeenCalledTimes(1);
    });

    it('useNotifications=false 时失败更新不应显示错误通知', async () => {
      mockPut.mockRejectedValueOnce(new Error('失败'));

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      await store.updateTag(1, '标签');

      expect(mockShowError).not.toHaveBeenCalled();
    });

    it('请求前应重置 error', async () => {
      mockPut.mockResolvedValueOnce({});
      mockGet.mockResolvedValueOnce({ data: [] });

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      store.error = '旧错误';
      await store.updateTag(1, '名称');

      expect(store.error).toBeNull();
    });
  });

  describe('deleteTag', () => {
    it('成功删除标签后应清除缓存并刷新列表', async () => {
      mockDelete.mockResolvedValueOnce({});
      const remainingTags = [createMockTag({ id: 2, name: '保留标签' })];
      mockGet.mockResolvedValueOnce({ data: remainingTags });

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      const result = await store.deleteTag(1);

      expect(result).toBe(true);
      expect(mockDelete).toHaveBeenCalledWith('/test-tags/1');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('testTagsCache');
      expect(store.isLoading).toBe(false);
    });

    it('删除失败时应返回 false 并设置错误状态', async () => {
      mockDelete.mockRejectedValueOnce(new Error('删除失败'));

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      const result = await store.deleteTag(1);

      expect(result).toBe(false);
      expect(store.error).toBe('删除失败');
      expect(store.isLoading).toBe(false);
    });

    it('useNotifications=true 时成功删除应显示成功通知', async () => {
      mockDelete.mockResolvedValueOnce({});
      mockGet.mockResolvedValueOnce({ data: [] });

      const useStore = createTagStore(quickCommandTagsConfig);
      const store = useStore();
      await store.deleteTag(1);

      expect(mockShowSuccess).toHaveBeenCalledWith('标签已删除');
    });

    it('useNotifications=false 时成功删除不应显示通知', async () => {
      mockDelete.mockResolvedValueOnce({});
      mockGet.mockResolvedValueOnce({ data: [] });

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      await store.deleteTag(1);

      expect(mockShowSuccess).not.toHaveBeenCalled();
    });

    it('useNotifications=true 时失败删除应显示错误通知', async () => {
      mockDelete.mockRejectedValueOnce(new Error('失败'));

      const useStore = createTagStore(quickCommandTagsConfig);
      const store = useStore();
      await store.deleteTag(1);

      expect(mockShowError).toHaveBeenCalledTimes(1);
    });

    it('useNotifications=false 时失败删除不应显示错误通知', async () => {
      mockDelete.mockRejectedValueOnce(new Error('失败'));

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      await store.deleteTag(1);

      expect(mockShowError).not.toHaveBeenCalled();
    });

    it('请求前应重置 error', async () => {
      mockDelete.mockResolvedValueOnce({});
      mockGet.mockResolvedValueOnce({ data: [] });

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      store.error = '旧错误';
      await store.deleteTag(1);

      expect(store.error).toBeNull();
    });
  });

  describe('配置选项验证', () => {
    it('两个不同 storeId 的实例应各自独立', () => {
      const useTagStore = createTagStore(tagsConfig);
      const useQuickStore = createTagStore(quickCommandTagsConfig);

      const tagStore = useTagStore();
      const quickStore = useQuickStore();

      tagStore.tags = [createMockTag({ id: 1, name: 'tag1' })];
      quickStore.tags = [createMockTag({ id: 2, name: 'quick1' })];

      expect(tagStore.tags).toHaveLength(1);
      expect(quickStore.tags).toHaveLength(1);
      expect(tagStore.tags[0].name).toBe('tag1');
      expect(quickStore.tags[0].name).toBe('quick1');
    });

    it('同一 storeId 的多个实例应共享状态', () => {
      const useStore = createTagStore(tagsConfig);
      const store1 = useStore();
      const store2 = useStore();

      store1.tags = [createMockTag({ id: 1, name: 'shared' })];

      expect(store2.tags).toHaveLength(1);
      expect(store2.tags[0].name).toBe('shared');
    });

    it('useNotifications 默认为 true', async () => {
      const configWithoutNotifications: TagStoreConfig = {
        storeId: 'testDefaultNotifications',
        apiEndpoint: '/test-default-tags',
        cacheKey: 'testDefaultTagsCache',
        // useNotifications 未指定，默认为 true
      };

      const newTag = createMockTag({ id: 1 });
      mockPost.mockResolvedValueOnce({ data: { message: 'ok', tag: newTag } });
      mockGet.mockResolvedValueOnce({ data: [newTag] });

      const useStore = createTagStore(configWithoutNotifications);
      const store = useStore();
      await store.addTag('标签');

      // 默认 useNotifications=true，应显示成功通知
      expect(mockShowSuccess).toHaveBeenCalledWith('标签已添加');
    });
  });

  describe('缓存行为', () => {
    it('fetchTags 应使用配置中的 cacheKey', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      await store.fetchTags();

      expect(mockLocalStorage.getItem).toHaveBeenCalledWith('testTagsCache');
    });

    it('addTag 成功后应清除指定 cacheKey', async () => {
      const newTag = createMockTag({ id: 1 });
      mockPost.mockResolvedValueOnce({ data: { message: 'ok', tag: newTag } });
      mockGet.mockResolvedValueOnce({ data: [newTag] });

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      await store.addTag('标签');

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('testTagsCache');
    });

    it('updateTag 成功后应清除指定 cacheKey', async () => {
      mockPut.mockResolvedValueOnce({});
      mockGet.mockResolvedValueOnce({ data: [] });

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      await store.updateTag(1, '更新');

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('testTagsCache');
    });

    it('deleteTag 成功后应清除指定 cacheKey', async () => {
      mockDelete.mockResolvedValueOnce({});
      mockGet.mockResolvedValueOnce({ data: [] });

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      await store.deleteTag(1);

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('testTagsCache');
    });
  });

  describe('边界条件', () => {
    it('fetchTags 返回空数组时 tags 应为空', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      const result = await store.fetchTags();

      expect(result).toBe(true);
      expect(store.tags).toEqual([]);
    });

    it('fetchTags 成功后应清除之前的 error', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      store.error = '旧错误';
      await store.fetchTags();

      expect(store.error).toBeNull();
    });

    it('isLoading 在所有操作完成后应为 false', async () => {
      const useStore = createTagStore(tagsConfig);
      const store = useStore();

      // fetchTags 成功
      mockGet.mockResolvedValueOnce({ data: [] });
      await store.fetchTags();
      expect(store.isLoading).toBe(false);

      // fetchTags 失败
      mockGet.mockRejectedValueOnce(new Error('fail'));
      await store.fetchTags();
      expect(store.isLoading).toBe(false);

      // addTag 失败
      mockPost.mockRejectedValueOnce(new Error('fail'));
      await store.addTag('tag');
      expect(store.isLoading).toBe(false);

      // updateTag 失败
      mockPut.mockRejectedValueOnce(new Error('fail'));
      await store.updateTag(1, 'tag');
      expect(store.isLoading).toBe(false);

      // deleteTag 失败
      mockDelete.mockRejectedValueOnce(new Error('fail'));
      await store.deleteTag(1);
      expect(store.isLoading).toBe(false);
    });

    it('addTag 内部 fetchTags 失败时应返回新标签但不显示成功通知（useNotifications=true）', async () => {
      const newTag = createMockTag({ id: 3, name: '新标签' });
      mockPost.mockResolvedValueOnce({ data: { message: 'ok', tag: newTag } });
      mockGet.mockRejectedValueOnce(new Error('fetch failed')); // fetchTags 失败

      const useStore = createTagStore(quickCommandTagsConfig);
      const store = useStore();
      const result = await store.addTag('新标签');

      // 即使 fetchTags 失败，addTag 仍返回新标签
      expect(result).toEqual(newTag);
      // fetchTags 失败 (fetchSuccess=false)，所以不显示成功通知
      expect(mockShowSuccess).not.toHaveBeenCalled();
    });

    it('多次 fetchTags 调用的最终状态应正确', async () => {
      const tags1 = [createMockTag({ id: 1, name: '第一次' })];
      const tags2 = [createMockTag({ id: 1, name: '第二次' })];

      mockGet.mockResolvedValueOnce({ data: tags1 }).mockResolvedValueOnce({ data: tags2 });

      const useStore = createTagStore(tagsConfig);
      const store = useStore();

      await store.fetchTags();
      expect(store.tags).toEqual(tags1);

      await store.fetchTags();
      expect(store.tags).toEqual(tags2);
    });

    it('API 响应中 error 字段应优先于 message 字段', async () => {
      mockGet.mockRejectedValueOnce({
        response: { data: { error: '自定义错误', message: '其他消息' } },
      });

      const useStore = createTagStore(tagsConfig);
      const store = useStore();
      await store.fetchTags();

      expect(store.error).toBe('自定义错误');
    });
  });
});
