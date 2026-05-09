/**
 * useChangePassword 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const mockChangePassword = vi.fn();
vi.mock('../../stores/auth.store', () => ({
  useAuthStore: () => ({
    changePassword: mockChangePassword,
  }),
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock('@/utils/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('useChangePassword', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('应初始化为空状态', async () => {
    const { useChangePassword } = await import('./useChangePassword');
    const {
      currentPassword,
      newPassword,
      confirmPassword,
      changePasswordLoading,
      changePasswordSuccess,
    } = useChangePassword();

    expect(currentPassword.value).toBe('');
    expect(newPassword.value).toBe('');
    expect(confirmPassword.value).toBe('');
    expect(changePasswordLoading.value).toBe(false);
    expect(changePasswordSuccess.value).toBe(false);
  });

  it('密码不匹配时应显示错误', async () => {
    const { useChangePassword } = await import('./useChangePassword');
    const {
      currentPassword,
      newPassword,
      confirmPassword,
      handleChangePassword,
      changePasswordMessage,
    } = useChangePassword();

    currentPassword.value = 'old';
    newPassword.value = 'new1';
    confirmPassword.value = 'new2';

    await handleChangePassword();

    expect(changePasswordMessage.value).toBeTruthy();
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it('字段为空时应显示错误', async () => {
    const { useChangePassword } = await import('./useChangePassword');
    const { handleChangePassword, changePasswordMessage } = useChangePassword();

    await handleChangePassword();

    expect(changePasswordMessage.value).toBeTruthy();
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it('修改成功时应显示成功消息', async () => {
    mockChangePassword.mockResolvedValue(undefined);
    const { useChangePassword } = await import('./useChangePassword');
    const {
      currentPassword,
      newPassword,
      confirmPassword,
      handleChangePassword,
      changePasswordSuccess,
      changePasswordMessage,
    } = useChangePassword();

    currentPassword.value = 'oldPass';
    newPassword.value = 'newPass';
    confirmPassword.value = 'newPass';

    await handleChangePassword();

    expect(mockChangePassword).toHaveBeenCalledWith('oldPass', 'newPass');
    expect(changePasswordSuccess.value).toBe(true);
    expect(changePasswordMessage.value).toBeTruthy();
    expect(currentPassword.value).toBe('');
    expect(newPassword.value).toBe('');
    expect(confirmPassword.value).toBe('');
  });

  it('修改失败时应显示错误消息', async () => {
    mockChangePassword.mockRejectedValue(new Error('密码错误'));
    const { useChangePassword } = await import('./useChangePassword');
    const {
      currentPassword,
      newPassword,
      confirmPassword,
      handleChangePassword,
      changePasswordSuccess,
      changePasswordMessage,
    } = useChangePassword();

    currentPassword.value = 'wrong';
    newPassword.value = 'new';
    confirmPassword.value = 'new';

    await handleChangePassword();

    expect(changePasswordSuccess.value).toBe(false);
    expect(changePasswordMessage.value).toContain('密码错误');
  });
});
