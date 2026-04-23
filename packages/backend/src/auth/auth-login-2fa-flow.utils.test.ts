import { describe, expect, it } from 'vitest';
import { Request } from 'express';
import {
  createPendingLoginTwoFactorAuthState,
  resolveLogin2FATokenValidation,
  resolveLoginPendingAuthValidation,
} from './auth-login-2fa-flow.utils';

describe('auth-login-2fa-flow.utils', () => {
  it('pending 缺失时应返回无效认证状态', () => {
    const req = {
      session: {},
    } as unknown as Request;

    const result = resolveLoginPendingAuthValidation({
      req,
      tempToken: 'valid-token',
    });

    expect(result).toEqual({
      ok: false,
      reason: 'invalid_state',
      failure: {
        statusCode: 401,
        body: { message: '无效的认证状态。' },
      },
    });
  });

  it('pending 过期时应删除 pending 并返回过期响应', () => {
    const now = Date.now();
    const req = {
      session: {
        pendingAuth: {
          tempToken: 'valid-token',
          userId: 1,
          username: 'alice',
          expiresAt: now - 1,
        },
      },
    } as unknown as Request;

    const result = resolveLoginPendingAuthValidation({
      req,
      tempToken: 'valid-token',
      now,
    });

    expect(result).toEqual({
      ok: false,
      reason: 'expired',
      failure: {
        statusCode: 401,
        body: { message: '认证已过期，请重新登录。' },
      },
    });
    expect((req.session as unknown as { pendingAuth?: unknown }).pendingAuth).toBeUndefined();
  });

  it('tempToken 不匹配时应返回无效认证状态', () => {
    const req = {
      session: {
        pendingAuth: {
          tempToken: 'valid-token',
          userId: 1,
          username: 'alice',
          expiresAt: Date.now() + 60_000,
        },
      },
    } as unknown as Request;

    const result = resolveLoginPendingAuthValidation({
      req,
      tempToken: 'wrong-token',
    });

    expect(result).toEqual({
      ok: false,
      reason: 'invalid_state',
      failure: {
        statusCode: 401,
        body: { message: '无效的认证状态。' },
      },
    });
  });

  it('token 无效时应返回 400（格式错误）', () => {
    const result = resolveLogin2FATokenValidation('12ab');
    expect(result).toEqual({
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '验证码格式无效。' },
      },
    });
  });

  it('token 为空时应返回 400（不能为空）', () => {
    const result = resolveLogin2FATokenValidation('  ');
    expect(result).toEqual({
      ok: false,
      failure: {
        statusCode: 400,
        body: { message: '验证码不能为空。' },
      },
    });
  });

  it('pending 与 token 均有效时应返回 pendingAuth', () => {
    const req = {
      session: {
        pendingAuth: {
          tempToken: 'valid-token',
          userId: 1,
          username: 'alice',
          expiresAt: Date.now() + 60_000,
        },
      },
    } as unknown as Request;

    const result = resolveLoginPendingAuthValidation({
      req,
      tempToken: 'valid-token',
    });

    expect(result).toEqual({
      ok: true,
      pendingAuth: {
        tempToken: 'valid-token',
        userId: 1,
        username: 'alice',
        expiresAt: (req.session as unknown as { pendingAuth: { expiresAt: number } }).pendingAuth
          .expiresAt,
      },
    });
  });

  it('createPendingLoginTwoFactorAuthState 应按约定生成 tempToken 与 expiresAt', () => {
    const result = createPendingLoginTwoFactorAuthState({
      userId: 3,
      username: 'neo',
      tempTokenLength: 4,
      pendingAuthTimeoutMs: 300_000,
      now: 1_000,
      randomBytesFn: () => Buffer.from('a1b2c3d4', 'hex'),
    });

    expect(result).toEqual({
      tempToken: 'a1b2c3d4',
      userId: 3,
      username: 'neo',
      expiresAt: 301_000,
    });
  });
});
