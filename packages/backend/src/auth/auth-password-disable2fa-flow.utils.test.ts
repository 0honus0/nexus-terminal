import { describe, expect, it } from 'vitest';
import {
  resolveChangePasswordAccessValidation,
  resolveChangePasswordInputValidation,
  resolveCurrentPasswordMatchValidation,
  resolveDisable2FAAccessValidation,
  resolveDisable2FAInputValidation,
  resolveMutationChangesValidation,
  resolvePasswordActionUserValidation,
} from './auth-password-disable2fa-flow.utils';

describe('auth-password-disable2fa-flow.utils', () => {
  it('changePassword 未认证应返回 401', () => {
    const result = resolveChangePasswordAccessValidation({
      userId: undefined,
      requiresTwoFactor: false,
    });

    expect(result).toEqual({
      ok: false,
      failure: {
        statusCode: 401,
        body: { message: '用户未认证或认证未完成，请先登录。' },
      },
    });
  });

  it('disable2FA 缺少密码应返回 400', () => {
    const result = resolveDisable2FAInputValidation({
      password: '',
    });

    expect(result).toEqual({
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '需要提供当前密码才能禁用两步验证。' },
      },
    });
  });

  it('changePassword 新密码过短应返回 400', () => {
    const result = resolveChangePasswordInputValidation({
      currentPassword: 'old-password',
      newPassword: 'short',
    });

    expect(result).toEqual({
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '新密码长度至少需要 8 位。' },
      },
    });
  });

  it('changePassword 新旧密码相同应返回 400', () => {
    const result = resolveChangePasswordInputValidation({
      currentPassword: 'same-password',
      newPassword: 'same-password',
    });

    expect(result).toEqual({
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '新密码不能与当前密码相同。' },
      },
    });
  });

  it('密码错误路径应返回 400', () => {
    const result = resolveCurrentPasswordMatchValidation({ isMatch: false });

    expect(result).toEqual({
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '当前密码不正确。' },
      },
    });
  });

  it('用户不存在路径应返回 404', () => {
    const result = resolvePasswordActionUserValidation({ user: null });

    expect(result).toEqual({
      ok: false,
      failure: {
        statusCode: 404,
        body: { message: '用户不存在。' },
      },
    });
  });

  it('更新影响行数为 0 时应映射为标准错误', () => {
    const result = resolveMutationChangesValidation({ changes: 0 });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error.message).toBe('未找到要更新的用户');
  });

  it('changePassword 成功路径应返回归一化输入', () => {
    const accessResult = resolveChangePasswordAccessValidation({
      userId: 7,
      requiresTwoFactor: false,
    });
    const inputResult = resolveChangePasswordInputValidation({
      currentPassword: 'old-password',
      newPassword: 'new-password-123',
    });
    const userResult = resolvePasswordActionUserValidation({
      user: { id: 7, hashed_password: 'hashed' },
    });
    const matchResult = resolveCurrentPasswordMatchValidation({ isMatch: true });
    const changeResult = resolveMutationChangesValidation({ changes: 1 });

    expect(accessResult).toEqual({ ok: true, actor: { userId: 7 } });
    expect(inputResult).toEqual({
      ok: true,
      input: { currentPassword: 'old-password', newPassword: 'new-password-123' },
    });
    expect(userResult).toEqual({ ok: true, user: { id: 7, hashed_password: 'hashed' } });
    expect(matchResult).toEqual({ ok: true });
    expect(changeResult).toEqual({ ok: true });
  });

  it('disable2FA 成功路径应返回 actor 与 input', () => {
    const accessResult = resolveDisable2FAAccessValidation({
      userId: 9,
      requiresTwoFactor: false,
    });
    const inputResult = resolveDisable2FAInputValidation({
      password: 'valid-password',
    });

    expect(accessResult).toEqual({ ok: true, actor: { userId: 9 } });
    expect(inputResult).toEqual({ ok: true, input: { password: 'valid-password' } });
  });

  it('disable2FA 认证未完成应返回 401', () => {
    const result = resolveDisable2FAAccessValidation({
      userId: 9,
      requiresTwoFactor: true,
    });

    expect(result).toEqual({
      ok: false,
      failure: {
        statusCode: 401,
        body: { message: '用户未认证或认证未完成。' },
      },
    });
  });
});
