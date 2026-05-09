/**
 * useImportConnections 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const mockApiPost = vi.fn();
vi.mock('../../utils/apiClient', () => ({
  default: {
    post: (...args: unknown[]) => mockApiPost(...args),
  },
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (_key: string, fallback?: string) => fallback || _key,
  }),
}));

vi.mock('axios', () => ({
  isAxiosError: (err: unknown) => err && typeof err === 'object' && 'response' in err,
  default: {
    isAxiosError: (err: unknown) => err && typeof err === 'object' && 'response' in err,
  },
}));

vi.mock('@/utils/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('useImportConnections', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('应初始化为空状态', async () => {
    const { useImportConnections } = await import('./useImportConnections');
    const { importLoading, importSuccess, importMessage } = useImportConnections();

    expect(importLoading.value).toBe(false);
    expect(importSuccess.value).toBe(false);
    expect(importMessage.value).toBe('');
  });

  it('导入成功应设置成功状态', async () => {
    mockApiPost.mockResolvedValue({ data: { successCount: 5, failureCount: 0, errors: [] } });

    const { useImportConnections } = await import('./useImportConnections');
    const { handleImportConnections, importSuccess } = useImportConnections();

    const file = new File(['test'], 'test.json', { type: 'application/json' });
    await handleImportConnections(file);

    expect(importSuccess.value).toBe(true);
  });

  it('导入失败应设置错误状态', async () => {
    mockApiPost.mockRejectedValue(new Error('Import failed'));

    const { useImportConnections } = await import('./useImportConnections');
    const { handleImportConnections, importSuccess, importMessage } = useImportConnections();

    const file = new File(['test'], 'test.json', { type: 'application/json' });
    await handleImportConnections(file);

    expect(importSuccess.value).toBe(false);
    expect(importMessage.value).toBeTruthy();
  });

  it('应返回所有预期的属性', async () => {
    const { useImportConnections } = await import('./useImportConnections');
    const result = useImportConnections();

    expect(result).toHaveProperty('importLoading');
    expect(result).toHaveProperty('importMessage');
    expect(result).toHaveProperty('importSuccess');
    expect(result).toHaveProperty('importResult');
    expect(result).toHaveProperty('handleImportConnections');
    expect(result).toHaveProperty('resetImportState');
  });
});
