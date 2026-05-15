import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import apiClient from '../utils/apiClient';
import { usePathHistoryStore } from './pathHistory.store';

const { uiNotificationsStoreMock } = vi.hoisted(() => {
  return {
    uiNotificationsStoreMock: {
      showError: vi.fn(),
      showSuccess: vi.fn(),
      addNotification: vi.fn(),
    },
  };
});

vi.mock('../utils/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('./uiNotifications.store', () => ({
  useUiNotificationsStore: () => uiNotificationsStoreMock,
}));

describe('pathHistory.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('filteredHistory 应按 searchTerm 过滤（不区分大小写）', () => {
    const store = usePathHistoryStore();
    store.historyList = [
      { id: 1, path: '/Home', timestamp: 1 },
      { id: 2, path: '/var', timestamp: 2 },
    ] as any;
    store.setSearchTerm('home');
    expect(store.filteredHistory).toHaveLength(1);
    expect(store.filteredHistory[0].id).toBe(1);
    expect(store.selectedIndex).toBe(-1);
  });

  it('selectNextPath / selectPreviousPath 在空列表时应重置 selectedIndex', () => {
    const store = usePathHistoryStore();
    store.selectNextPath();
    expect(store.selectedIndex).toBe(-1);
    store.selectPreviousPath();
    expect(store.selectedIndex).toBe(-1);
  });

  it('fetchHistory 应将后端数据按 timestamp 降序排序', async () => {
    const store = usePathHistoryStore();
    (apiClient.get as any).mockResolvedValueOnce({
      data: [
        { id: 1, path: '/a', timestamp: 1 },
        { id: 2, path: '/b', timestamp: 10 },
      ],
    });

    await store.fetchHistory();
    expect(store.historyList.map((e) => e.id)).toEqual([2, 1]);
    expect(store.isLoading).toBe(false);
    expect(store.error).toBeNull();
  });

  it('addPath 传入空字符串时应直接返回且不调用接口', async () => {
    const store = usePathHistoryStore();
    await store.addPath('   ');
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('deletePath 成功时应从列表移除并提示成功', async () => {
    const store = usePathHistoryStore();
    store.historyList = [
      { id: 1, path: '/a', timestamp: 1 },
      { id: 2, path: '/b', timestamp: 2 },
    ] as any;

    (apiClient.delete as any).mockResolvedValueOnce(undefined);
    await store.deletePath(1);
    expect(store.historyList.map((e) => e.id)).toEqual([2]);
    expect(uiNotificationsStoreMock.showSuccess).toHaveBeenCalled();
  });

  it('clearAllHistory 成功时应清空列表并提示成功', async () => {
    const store = usePathHistoryStore();
    store.historyList = [{ id: 1, path: '/a', timestamp: 1 }] as any;

    (apiClient.delete as any).mockResolvedValueOnce(undefined);
    await store.clearAllHistory();
    expect(store.historyList).toEqual([]);
    expect(uiNotificationsStoreMock.showSuccess).toHaveBeenCalled();
  });

  it('addPath 成功时应发送 POST 并清除缓存后刷新列表', async () => {
    const store = usePathHistoryStore();
    (apiClient.post as any).mockResolvedValueOnce({});
    (apiClient.get as any).mockResolvedValueOnce({
      data: [{ id: 1, path: '/new/path', timestamp: 9999 }],
    });

    await store.addPath('/new/path');

    expect(apiClient.post).toHaveBeenCalledWith('/path-history', { path: '/new/path' });
    expect(apiClient.get).toHaveBeenCalledWith('/path-history');
  });

  it('addPath 传入 Ctrl+C 信号（\\x03）时不应发送请求', async () => {
    const store = usePathHistoryStore();
    await store.addPath('\x03');
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('addPath 应自动 trim 路径字符串', async () => {
    const store = usePathHistoryStore();
    (apiClient.post as any).mockResolvedValueOnce({});
    (apiClient.get as any).mockResolvedValueOnce({ data: [] });

    await store.addPath('  /home/user  ');

    expect(apiClient.post).toHaveBeenCalledWith('/path-history', { path: '/home/user' });
  });

  it('addPath 失败时应显示错误通知', async () => {
    const store = usePathHistoryStore();
    (apiClient.post as any).mockRejectedValueOnce(new Error('add-fail'));

    await store.addPath('/some/path');

    expect(uiNotificationsStoreMock.showError).toHaveBeenCalledTimes(1);
  });

  it('deletePath 失败时应显示错误通知', async () => {
    const store = usePathHistoryStore();
    store.historyList = [{ id: 1, path: '/a', timestamp: 1 }] as any;

    (apiClient.delete as any).mockRejectedValueOnce(new Error('del-fail'));
    await store.deletePath(1);

    expect(uiNotificationsStoreMock.showError).toHaveBeenCalledTimes(1);
    expect(store.historyList).toHaveLength(1); // 失败时不移除
  });

  it('clearAllHistory 失败时应显示错误通知', async () => {
    const store = usePathHistoryStore();
    store.historyList = [{ id: 1, path: '/a', timestamp: 1 }] as any;

    (apiClient.delete as any).mockRejectedValueOnce(new Error('clear-fail'));
    await store.clearAllHistory();

    expect(uiNotificationsStoreMock.showError).toHaveBeenCalledTimes(1);
    expect(store.historyList).toHaveLength(1); // 失败时不清空
  });

  it('fetchHistory 失败时应设置 error 并显示通知', async () => {
    const store = usePathHistoryStore();
    (apiClient.get as any).mockRejectedValueOnce(new Error('fetch-fail'));

    await store.fetchHistory();

    expect(store.error).toBeTruthy();
    expect(store.isLoading).toBe(false);
    expect(uiNotificationsStoreMock.showError).toHaveBeenCalledTimes(1);
  });

  it('selectNextPath 应从最后一条循环回到第一条', () => {
    const store = usePathHistoryStore();
    store.historyList = [
      { id: 1, path: '/a', timestamp: 1 },
      { id: 2, path: '/b', timestamp: 2 },
      { id: 3, path: '/c', timestamp: 3 },
    ] as any;
    store.selectedIndex = 2;

    store.selectNextPath();
    expect(store.selectedIndex).toBe(0);
  });

  it('selectPreviousPath 在 selectedIndex=-1 时应跳到最后一条', () => {
    const store = usePathHistoryStore();
    store.historyList = [
      { id: 1, path: '/a', timestamp: 1 },
      { id: 2, path: '/b', timestamp: 2 },
      { id: 3, path: '/c', timestamp: 3 },
    ] as any;
    store.selectedIndex = -1;

    store.selectPreviousPath();
    expect(store.selectedIndex).toBe(2);
  });

  it('selectPreviousPath 从 0 回退应循环到最后一条', () => {
    const store = usePathHistoryStore();
    store.historyList = [
      { id: 1, path: '/a', timestamp: 1 },
      { id: 2, path: '/b', timestamp: 2 },
    ] as any;
    store.selectedIndex = 0;

    store.selectPreviousPath();
    expect(store.selectedIndex).toBe(1);
  });

  it('resetSelection 应将 selectedIndex 重置为 -1', () => {
    const store = usePathHistoryStore();
    store.historyList = [{ id: 1, path: '/a', timestamp: 1 }] as any;
    store.selectedIndex = 0;

    store.resetSelection();
    expect(store.selectedIndex).toBe(-1);
  });

  it('setSearchTerm 应设置搜索词并重置 selectedIndex', () => {
    const store = usePathHistoryStore();
    store.historyList = [{ id: 1, path: '/a', timestamp: 1 }] as any;
    store.selectedIndex = 0;

    store.setSearchTerm('/home');
    expect(store.searchTerm).toBe('/home');
    expect(store.selectedIndex).toBe(-1);
  });

  it('filteredHistory 搜索词大小写不敏感', () => {
    const store = usePathHistoryStore();
    store.historyList = [
      { id: 1, path: '/Home/User', timestamp: 1 },
      { id: 2, path: '/var/log', timestamp: 2 },
    ] as any;
    store.setSearchTerm('HOME');
    expect(store.filteredHistory).toHaveLength(1);
    expect(store.filteredHistory[0].id).toBe(1);
  });

  it('使用 addCommand 别名时应与 addPath 行为一致', async () => {
    const store = usePathHistoryStore();
    (apiClient.post as any).mockResolvedValueOnce({});
    (apiClient.get as any).mockResolvedValueOnce({ data: [] });

    await store.addPath('/alias/test');
    expect(apiClient.post).toHaveBeenCalledWith('/path-history', { path: '/alias/test' });
  });

  it('fetchHistory 使用正确的 API 端点', async () => {
    const store = usePathHistoryStore();
    (apiClient.get as any).mockResolvedValueOnce({ data: [] });

    await store.fetchHistory();

    expect(apiClient.get).toHaveBeenCalledWith('/path-history');
  });

  it('fetchHistory 应将 reverseOrder=true 时翻转后端数据', async () => {
    const store = usePathHistoryStore();
    (apiClient.get as any).mockResolvedValueOnce({
      data: [
        { id: 1, path: '/first', timestamp: 1 },
        { id: 2, path: '/second', timestamp: 2 },
        { id: 3, path: '/third', timestamp: 3 },
      ],
    });

    await store.fetchHistory();

    expect(store.historyList[0].id).toBe(3);
    expect(store.historyList[2].id).toBe(1);
  });
});
