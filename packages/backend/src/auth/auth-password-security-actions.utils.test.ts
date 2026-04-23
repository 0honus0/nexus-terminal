import { describe, expect, it } from 'vitest';
import {
  buildChangePasswordSuccessAction,
  buildDisableTwoFactorSuccessAction,
  buildPasswordSecuritySideEffects,
} from './auth-password-security-actions.utils';

describe('auth-password-security-actions.utils', () => {
  it('应构建 PASSWORD_CHANGED 的审计与通知 sideEffects', () => {
    const sideEffects = buildPasswordSecuritySideEffects({
      event: 'PASSWORD_CHANGED',
      userId: 11,
      clientIp: '127.0.0.1',
    });

    expect(sideEffects).toEqual([
      {
        kind: 'audit',
        action: 'PASSWORD_CHANGED',
        payload: { userId: 11, ip: '127.0.0.1' },
      },
      {
        kind: 'notification',
        event: 'PASSWORD_CHANGED',
        payload: { userId: 11, ip: '127.0.0.1' },
      },
    ]);
  });

  it('changePassword 成功动作应保持状态码与文案语义', () => {
    const action = buildChangePasswordSuccessAction({
      userId: 12,
      clientIp: '10.0.0.2',
    });

    expect(action.response).toEqual({
      statusCode: 200,
      body: { message: '密码已成功修改。' },
    });
    expect(action.log).toEqual({
      level: 'info',
      message: '用户 12 密码已成功修改。',
    });
    expect(action.sideEffects).toEqual([
      {
        kind: 'audit',
        action: 'PASSWORD_CHANGED',
        payload: { userId: 12, ip: '10.0.0.2' },
      },
      {
        kind: 'notification',
        event: 'PASSWORD_CHANGED',
        payload: { userId: 12, ip: '10.0.0.2' },
      },
    ]);
  });

  it('disable2FA 成功动作应保持状态码与文案语义', () => {
    const action = buildDisableTwoFactorSuccessAction({
      userId: 13,
      clientIp: '192.168.1.88',
    });

    expect(action.response).toEqual({
      statusCode: 200,
      body: { message: '两步验证已成功禁用。' },
    });
    expect(action.log).toEqual({
      level: 'info',
      message: '用户 13 已成功禁用两步验证。',
    });
    expect(action.sideEffects).toEqual([
      {
        kind: 'audit',
        action: '2FA_DISABLED',
        payload: { userId: 13, ip: '192.168.1.88' },
      },
      {
        kind: 'notification',
        event: '2FA_DISABLED',
        payload: { userId: 13, ip: '192.168.1.88' },
      },
    ]);
  });
});
