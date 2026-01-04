import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from './auth.store';
import apiClient from '../utils/apiClient';
import router from '../router';
import { setLocale } from '../i18n';

// Mock 依赖
vi.mock('../utils/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../router', () => ({
  default: {
    push: vi.fn(),
  },
}));

vi.mock('../i18n', () => ({
  setLocale: vi.fn(),
}));

// Mock window.location
delete (window as any).location;
(window as any).location = { href: '' };

describe('auth.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    window.location.href = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('初始状态', () => {
    it('应该有正确的初始状态', () => {
      const store = useAuthStore();
      expect(store.isAuthenticated).toBe(false);
      expect(store.user).toBeNull();
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.loginRequires2FA).toBe(false);
      expect(store.tempToken).toBeNull();
      expect(store.ipBlacklist).toEqual({ entries: [], total: 0 });
      expect(store.needsSetup).toBe(false);
      expect(store.publicCaptchaConfig).toBeNull();
      expect(store.passkeys).toBeNull();
      expect(store.passkeysLoading).toBe(false);
      expect(store.hasPasskeysAvailable).toBe(false);
    });
  });

  describe('clearError', () => {
    it('应该清除错误状态', () => {
      const store = useAuthStore();
      store.error = '测试错误';
      store.clearError();
      expect(store.error).toBeNull();
    });
  });

  describe('setError', () => {
    it('应该设置错误状态', () => {
      const store = useAuthStore();
      store.setError('测试错误消息');
      expect(store.error).toBe('测试错误消息');
    });
  });

  describe('login', () => {
    it('登录成功（无 2FA）应更新状态并跳转', async () => {
      const store = useAuthStore();
      const mockUser = { id: 1, username: 'testuser', language: 'zh' as const };

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: '登录成功', user: mockUser },
      });

      const result = await store.login({ username: 'testuser', password: 'pass' });

      expect(result).toEqual({ success: true });
      expect(store.isAuthenticated).toBe(true);
      expect(store.user).toEqual(mockUser);
      expect(store.loginRequires2FA).toBe(false);
      expect(setLocale).toHaveBeenCalledWith('zh');
      expect(window.location.href).toBe('/');
    });

    it('登录需要 2FA 时应返回特殊状态并保存临时令牌', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: {
          message: '需要 2FA',
          requiresTwoFactor: true,
          tempToken: 'temp-token-123',
        },
      });

      const result = await store.login({ username: 'testuser', password: 'pass' });

      expect(result).toEqual({ requiresTwoFactor: true });
      expect(store.loginRequires2FA).toBe(true);
      expect(store.tempToken).toBe('temp-token-123');
      expect(store.isAuthenticated).toBe(false);
      expect(store.user).toBeNull();
    });

    it('登录失败应设置错误状态', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.post).mockRejectedValueOnce({
        response: { data: { message: '用户名或密码错误' } },
      });

      const result = await store.login({ username: 'testuser', password: 'wrong' });

      expect(result).toEqual({ success: false, error: '用户名或密码错误' });
      expect(store.isAuthenticated).toBe(false);
      expect(store.user).toBeNull();
      expect(store.error).toBe('用户名或密码错误');
    });

    it('登录时应传递 CAPTCHA Token', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: '登录成功', user: { id: 1, username: 'testuser' } },
      });

      await store.login({
        username: 'testuser',
        password: 'pass',
        captchaToken: 'captcha-token',
      });

      expect(apiClient.post).toHaveBeenCalledWith('/auth/login', {
        username: 'testuser',
        password: 'pass',
        captchaToken: 'captcha-token',
      });
    });
  });

  describe('verifyLogin2FA', () => {
    it('2FA 验证成功应更新状态并跳转', async () => {
      const store = useAuthStore();
      const mockUser = { id: 1, username: 'testuser', language: 'en' as const };

      store.loginRequires2FA = true;
      store.tempToken = 'temp-token';

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: '验证成功', user: mockUser },
      });

      const result = await store.verifyLogin2FA('123456');

      expect(result).toEqual({ success: true });
      expect(store.isAuthenticated).toBe(true);
      expect(store.user).toEqual(mockUser);
      expect(store.loginRequires2FA).toBe(false);
      expect(store.tempToken).toBeNull();
      expect(window.location.href).toBe('/');
    });

    it('2FA 验证失败应设置错误状态但保持 2FA 状态', async () => {
      const store = useAuthStore();
      store.loginRequires2FA = true;
      store.tempToken = 'temp-token';

      vi.mocked(apiClient.post).mockRejectedValueOnce({
        response: { data: { message: '验证码错误' } },
      });

      const result = await store.verifyLogin2FA('000000');

      expect(result).toEqual({ success: false, error: '验证码错误' });
      expect(store.error).toBe('验证码错误');
      expect(store.loginRequires2FA).toBe(true); // 保持状态
    });

    it('不在 2FA 流程时调用应抛出错误', async () => {
      const store = useAuthStore();
      store.loginRequires2FA = false;

      await expect(store.verifyLogin2FA('123456')).rejects.toThrow('当前登录流程不需要 2FA 验证。');
    });
  });

  describe('logout', () => {
    it('登出成功应清除状态并跳转到登录页', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;
      store.user = { id: 1, username: 'testuser' };

      vi.mocked(apiClient.post).mockResolvedValueOnce({});

      await store.logout();

      expect(store.isAuthenticated).toBe(false);
      expect(store.user).toBeNull();
      expect(router.push).toHaveBeenCalledWith({ name: 'Login' });
    });

    it('登出失败应设置错误状态', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;

      vi.mocked(apiClient.post).mockRejectedValueOnce({
        response: { data: { message: '登出失败' } },
      });

      await store.logout();

      expect(store.error).toBe('登出失败');
    });
  });

  describe('checkAuthStatus', () => {
    it('已认证状态应更新用户信息', async () => {
      const store = useAuthStore();
      const mockUser = {
        id: 1,
        username: 'testuser',
        isTwoFactorEnabled: true,
        language: 'zh' as const,
      };

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { isAuthenticated: true, user: mockUser },
      });

      await store.checkAuthStatus();

      expect(store.isAuthenticated).toBe(true);
      expect(store.user).toEqual(mockUser);
      expect(setLocale).toHaveBeenCalledWith('zh');
    });

    it('未认证状态应清除用户信息', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;
      store.user = { id: 1, username: 'testuser' };

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { isAuthenticated: false },
      });

      await store.checkAuthStatus();

      expect(store.isAuthenticated).toBe(false);
      expect(store.user).toBeNull();
    });

    it('检查失败应标记为未认证', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { status: 401, data: { message: 'Unauthorized' } },
      });

      await store.checkAuthStatus();

      expect(store.isAuthenticated).toBe(false);
      expect(store.user).toBeNull();
    });
  });

  describe('changePassword', () => {
    it('修改密码成功应返回 true', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;

      vi.mocked(apiClient.put).mockResolvedValueOnce({
        data: { message: '密码修改成功' },
      });

      const result = await store.changePassword('oldpass', 'newpass');

      expect(result).toBe(true);
      expect(apiClient.put).toHaveBeenCalledWith('/auth/password', {
        currentPassword: 'oldpass',
        newPassword: 'newpass',
      });
    });

    it('未登录时修改密码应抛出错误', async () => {
      const store = useAuthStore();
      store.isAuthenticated = false;

      await expect(store.changePassword('old', 'new')).rejects.toThrow(
        '用户未登录，无法修改密码。'
      );
    });

    it('修改密码失败应设置错误并抛出', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;

      vi.mocked(apiClient.put).mockRejectedValueOnce({
        response: { data: { message: '当前密码错误' } },
      });

      await expect(store.changePassword('wrong', 'new')).rejects.toThrow('当前密码错误');
      expect(store.error).toBe('当前密码错误');
    });
  });

  describe('IP 黑名单管理', () => {
    it('fetchIpBlacklist 应获取黑名单列表', async () => {
      const store = useAuthStore();
      const mockEntries = [
        {
          ip: '192.168.1.1',
          attempts: 5,
          last_attempt_at: Date.now(),
          blocked_until: Date.now() + 3600000,
        },
      ];

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { entries: mockEntries, total: 1 },
      });

      const result = await store.fetchIpBlacklist();

      expect(result).toEqual({ entries: mockEntries, total: 1 });
      expect(store.ipBlacklist.entries).toEqual(mockEntries);
      expect(store.ipBlacklist.total).toBe(1);
    });

    it('deleteIpFromBlacklist 应删除指定 IP', async () => {
      const store = useAuthStore();
      store.ipBlacklist.entries = [
        { ip: '192.168.1.1', attempts: 5, last_attempt_at: Date.now(), blocked_until: null },
        { ip: '192.168.1.2', attempts: 3, last_attempt_at: Date.now(), blocked_until: null },
      ];
      store.ipBlacklist.total = 2;

      vi.mocked(apiClient.delete).mockResolvedValueOnce({});

      const result = await store.deleteIpFromBlacklist('192.168.1.1');

      expect(result).toBe(true);
      expect(store.ipBlacklist.entries).toHaveLength(1);
      expect(store.ipBlacklist.entries[0].ip).toBe('192.168.1.2');
      expect(store.ipBlacklist.total).toBe(1);
    });
  });

  describe('checkSetupStatus', () => {
    it('需要设置时应返回 true', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { needsSetup: true },
      });

      const result = await store.checkSetupStatus();

      expect(result).toBe(true);
      expect(store.needsSetup).toBe(true);
    });

    it('检查失败应保守假设不需要设置', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('检查失败'));

      const result = await store.checkSetupStatus();

      expect(result).toBe(false);
      expect(store.needsSetup).toBe(false);
    });
  });

  describe('fetchCaptchaConfig', () => {
    it('应从 /settings/captcha 获取配置', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: {
          enabled: true,
          provider: 'hcaptcha' as const,
          hcaptchaSiteKey: 'site-key-123',
          hcaptchaSecretKey: 'secret',
        },
      });

      await store.fetchCaptchaConfig();

      expect(store.publicCaptchaConfig).toEqual({
        enabled: true,
        provider: 'hcaptcha',
        hcaptchaSiteKey: 'site-key-123',
        recaptchaSiteKey: undefined,
      });
    });

    it('获取失败应设置默认禁用配置', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('获取失败'));

      await store.fetchCaptchaConfig();

      expect(store.publicCaptchaConfig).toEqual({
        enabled: false,
        provider: 'none',
      });
    });
  });

  describe('Passkey 功能', () => {
    it('loginWithPasskey 成功应设置认证状态', async () => {
      const store = useAuthStore();
      const mockUser = { id: 1, username: 'testuser' };

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: '登录成功', user: mockUser },
      });

      const result = await store.loginWithPasskey('testuser', { id: 'cred-123' });

      expect(result).toEqual({ success: true });
      expect(store.isAuthenticated).toBe(true);
      expect(store.user).toEqual(mockUser);
    });

    it('fetchPasskeys 应获取用户 Passkey 列表', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;

      const mockBackendPasskeys = [
        {
          credential_id: 'cred-1',
          public_key: 'key-1',
          counter: 1,
          transports: ['usb', 'nfc'],
          created_at: '2023-01-01T00:00:00Z',
          last_used_at: '2023-12-01T00:00:00Z',
          name: 'My Key',
        },
      ];

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: mockBackendPasskeys,
      });

      await store.fetchPasskeys();

      expect(store.passkeys).toHaveLength(1);
      expect(store.passkeys![0]).toEqual({
        credentialID: 'cred-1',
        publicKey: 'key-1',
        counter: 1,
        transports: ['usb', 'nfc'],
        creationDate: '2023-01-01T00:00:00Z',
        lastUsedDate: '2023-12-01T00:00:00Z',
        name: 'My Key',
      });
    });

    it('未认证时 fetchPasskeys 应警告并清空列表', async () => {
      const store = useAuthStore();
      store.isAuthenticated = false;

      await store.fetchPasskeys();

      expect(store.passkeys).toBeNull();
    });

    it('deletePasskey 成功应刷新列表', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;

      vi.mocked(apiClient.delete).mockResolvedValueOnce({});
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });

      const result = await store.deletePasskey('cred-1');

      expect(result).toEqual({ success: true });
      expect(apiClient.delete).toHaveBeenCalledWith('/auth/user/passkeys/cred-1');
    });

    it('updatePasskeyName 成功应刷新列表', async () => {
      const store = useAuthStore();
      store.isAuthenticated = true;

      vi.mocked(apiClient.put).mockResolvedValueOnce({});
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });

      const result = await store.updatePasskeyName('cred-1', 'New Name');

      expect(result).toEqual({ success: true });
      expect(apiClient.put).toHaveBeenCalledWith('/auth/user/passkeys/cred-1/name', {
        name: 'New Name',
      });
    });

    it('checkHasPasskeysConfigured 应检查是否配置了 Passkey', async () => {
      const store = useAuthStore();

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { hasPasskeys: true },
      });

      const result = await store.checkHasPasskeysConfigured('testuser');

      expect(result).toBe(true);
      expect(store.hasPasskeysAvailable).toBe(true);
      expect(apiClient.get).toHaveBeenCalledWith('/auth/passkey/has-configured', {
        params: { username: 'testuser' },
      });
    });
  });

  describe('Getters', () => {
    it('loggedInUser 应返回用户名', () => {
      const store = useAuthStore();
      store.user = { id: 1, username: 'testuser' };

      expect(store.loggedInUser).toBe('testuser');
    });

    it('loggedInUser 未登录时应返回 undefined', () => {
      const store = useAuthStore();
      store.user = null;

      expect(store.loggedInUser).toBeUndefined();
    });
  });
});
