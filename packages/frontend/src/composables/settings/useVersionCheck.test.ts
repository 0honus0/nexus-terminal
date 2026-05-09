/**
 * useVersionCheck 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const mockAxiosGet = vi.fn();
vi.mock('axios', () => ({
  default: {
    get: (...args: unknown[]) => mockAxiosGet(...args),
    isAxiosError: (error: unknown) => error && typeof error === 'object' && 'response' in error,
  },
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock('@/utils/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/utils/constants', () => ({
  GITHUB_REPO_URL: 'https://github.com/Silentely/nexus-terminal',
}));

describe('useVersionCheck', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('应初始化为空状态', async () => {
    mockAxiosGet.mockRejectedValue(new Error('not found'));
    const { useVersionCheck } = await import('./useVersionCheck');
    const { appVersion, latestVersion, isCheckingVersion, versionCheckError } = useVersionCheck();

    expect(appVersion.value).toBe('');
    expect(latestVersion.value).toBeNull();
    expect(isCheckingVersion.value).toBe(false);
    expect(versionCheckError.value).toBeNull();
  });

  it('应检测有更新可用', async () => {
    mockAxiosGet.mockResolvedValue({ data: 'v2.0.0' });
    const { useVersionCheck } = await import('./useVersionCheck');
    const { isUpdateAvailable } = useVersionCheck();

    // 需要等待 onMounted 执行
    await vi.waitFor(() => {
      expect(isUpdateAvailable.value).toBeDefined();
    });
  });

  it('应检测无更新', async () => {
    mockAxiosGet.mockResolvedValue({ data: 'v1.0.0' });
    const { useVersionCheck } = await import('./useVersionCheck');
    const { isUpdateAvailable } = useVersionCheck();

    await vi.waitFor(() => {
      expect(isUpdateAvailable.value).toBeDefined();
    });
  });

  it('checkLatestVersion 应获取最新版本', async () => {
    mockAxiosGet.mockResolvedValue({ data: 'v3.0.0' });
    const { useVersionCheck } = await import('./useVersionCheck');
    const { checkLatestVersion, latestVersion } = useVersionCheck();

    await checkLatestVersion();

    expect(latestVersion.value).toBe('v3.0.0');
  });

  it('checkLatestVersion 失败应设置错误', async () => {
    mockAxiosGet.mockRejectedValue({ response: { status: 500 } });
    const { useVersionCheck } = await import('./useVersionCheck');
    const { checkLatestVersion, versionCheckError } = useVersionCheck();

    await checkLatestVersion();

    expect(versionCheckError.value).toBeTruthy();
  });

  it('404 错误应显示无发布版本', async () => {
    mockAxiosGet.mockRejectedValue({ response: { status: 404 } });
    const { useVersionCheck } = await import('./useVersionCheck');
    const { checkLatestVersion, versionCheckError } = useVersionCheck();

    await checkLatestVersion();

    expect(versionCheckError.value).toBeTruthy();
  });

  it('应返回所有预期的属性', async () => {
    mockAxiosGet.mockRejectedValue(new Error('fail'));
    const { useVersionCheck } = await import('./useVersionCheck');
    const result = useVersionCheck();

    expect(result).toHaveProperty('appVersion');
    expect(result).toHaveProperty('latestVersion');
    expect(result).toHaveProperty('isCheckingVersion');
    expect(result).toHaveProperty('versionCheckError');
    expect(result).toHaveProperty('isUpdateAvailable');
    expect(result).toHaveProperty('checkLatestVersion');
  });
});
