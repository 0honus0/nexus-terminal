import { Request } from 'express';
import { describe, expect, it } from 'vitest';
import {
  clearTwoFactorSessionSecret,
  readTwoFactorSessionSecret,
  setTwoFactorSessionSecret,
  syncTwoFactorSessionSecret,
} from './auth-two-factor-session-actions.utils';

const buildRequestWithSession = (tempTwoFactorSecret?: string): Request =>
  ({
    session: {
      tempTwoFactorSecret,
    },
  }) as unknown as Request;

describe('auth-two-factor-session-actions.utils', () => {
  it('应读写 session 临时 2FA 密钥', () => {
    const req = buildRequestWithSession();
    expect(readTwoFactorSessionSecret(req)).toBeUndefined();

    setTwoFactorSessionSecret(req, 'SECRET_A');
    expect(readTwoFactorSessionSecret(req)).toBe('SECRET_A');
  });

  it('sync 应仅在 secret 发生变化时写入', () => {
    const req = buildRequestWithSession('SECRET_A');

    expect(syncTwoFactorSessionSecret({ req, secret: 'SECRET_A' })).toBe(false);
    expect(readTwoFactorSessionSecret(req)).toBe('SECRET_A');

    expect(syncTwoFactorSessionSecret({ req, secret: 'SECRET_B' })).toBe(true);
    expect(readTwoFactorSessionSecret(req)).toBe('SECRET_B');
  });

  it('clear 应在存在密钥时清理并返回 true', () => {
    const req = buildRequestWithSession('SECRET_A');
    expect(clearTwoFactorSessionSecret(req)).toBe(true);
    expect(readTwoFactorSessionSecret(req)).toBeUndefined();
    expect(clearTwoFactorSessionSecret(req)).toBe(false);
  });
});
