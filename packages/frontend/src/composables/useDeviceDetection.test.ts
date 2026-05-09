/**
 * useDeviceDetection 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/utils/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('useDeviceDetection', () => {
  const originalUserAgent = navigator.userAgent;
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: originalUserAgent, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
  });

  it('应检测桌面设备', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      configurable: true,
    });
    Object.defineProperty(window, 'innerWidth', { value: 1920, configurable: true });

    const { useDeviceDetection } = await import('./useDeviceDetection');
    const { isMobile } = useDeviceDetection();

    expect(isMobile.value).toBe(false);
  });

  it('应检测移动设备', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
      configurable: true,
    });
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });

    const { useDeviceDetection } = await import('./useDeviceDetection');
    const { isMobile } = useDeviceDetection();

    expect(isMobile.value).toBe(true);
  });
});
