import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../database/connection';
import {
  resolveInitAuthState,
  resolveRequiresSetup,
  toPublicCaptchaConfig,
} from './auth-init-data.utils';

vi.mock('../database/connection', () => ({
  getDb: vi.fn(),
}));

describe('auth-init-data.utils', () => {
  const mockDb = {} as Parameters<typeof resolveRequiresSetup>[0];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('toPublicCaptchaConfig', () => {
    it('应仅返回前端可见字段', () => {
      const result = toPublicCaptchaConfig({
        enabled: true,
        provider: 'hcaptcha',
        hcaptchaSiteKey: 'site-key',
        hcaptchaSecretKey: 'secret-key',
        recaptchaSiteKey: 'recaptcha-site-key',
        recaptchaSecretKey: 'recaptcha-secret-key',
      });

      expect(result).toEqual({
        enabled: true,
        provider: 'hcaptcha',
        hcaptchaSiteKey: 'site-key',
        recaptchaSiteKey: 'recaptcha-site-key',
      });
      expect((result as Record<string, unknown>).hcaptchaSecretKey).toBeUndefined();
      expect((result as Record<string, unknown>).recaptchaSecretKey).toBeUndefined();
    });
  });

  describe('resolveRequiresSetup', () => {
    it('当用户数为 0 时应返回 true', async () => {
      vi.mocked(getDb).mockResolvedValue({ count: 0 });
      await expect(resolveRequiresSetup(mockDb)).resolves.toBe(true);
    });

    it('当用户数大于 0 时应返回 false', async () => {
      vi.mocked(getDb).mockResolvedValue({ count: 2 });
      await expect(resolveRequiresSetup(mockDb)).resolves.toBe(false);
    });

    it('当查询结果为空时应返回 true', async () => {
      vi.mocked(getDb).mockResolvedValue(undefined);
      await expect(resolveRequiresSetup(mockDb)).resolves.toBe(true);
    });
  });

  describe('resolveInitAuthState', () => {
    it('session 缺少 userId 时应返回未认证', async () => {
      const result = await resolveInitAuthState(mockDb, { username: 'alice' });
      expect(result).toEqual({ isAuthenticated: false, user: null });
      expect(getDb).not.toHaveBeenCalled();
    });

    it('session requiresTwoFactor=true 时应返回未认证', async () => {
      const result = await resolveInitAuthState(mockDb, {
        userId: 1,
        username: 'alice',
        requiresTwoFactor: true,
      });
      expect(result).toEqual({ isAuthenticated: false, user: null });
      expect(getDb).not.toHaveBeenCalled();
    });

    it('用户存在且 two_factor_secret 不为空时应返回已认证且开启 2FA', async () => {
      vi.mocked(getDb).mockResolvedValue({ two_factor_secret: 'secret' });
      const result = await resolveInitAuthState(mockDb, {
        userId: 1,
        username: 'alice',
        requiresTwoFactor: false,
      });
      expect(result).toEqual({
        isAuthenticated: true,
        user: {
          id: 1,
          username: 'alice',
          isTwoFactorEnabled: true,
        },
      });
    });

    it('用户存在但 two_factor_secret 为空时应返回已认证且未开启 2FA', async () => {
      vi.mocked(getDb).mockResolvedValue({ two_factor_secret: null });
      const result = await resolveInitAuthState(mockDb, {
        userId: 2,
        username: 'bob',
        requiresTwoFactor: false,
      });
      expect(result).toEqual({
        isAuthenticated: true,
        user: {
          id: 2,
          username: 'bob',
          isTwoFactorEnabled: false,
        },
      });
    });

    it('用户不存在时应返回未认证', async () => {
      vi.mocked(getDb).mockResolvedValue(undefined);
      const result = await resolveInitAuthState(mockDb, {
        userId: 2,
        username: 'bob',
        requiresTwoFactor: false,
      });
      expect(result).toEqual({ isAuthenticated: false, user: null });
    });
  });
});
