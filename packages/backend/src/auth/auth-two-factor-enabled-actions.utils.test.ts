import { describe, expect, it } from 'vitest';
import {
  buildTwoFactorEnabledSideEffects,
  buildTwoFactorEnabledSuccessAction,
} from './auth-two-factor-enabled-actions.utils';

describe('auth-two-factor-enabled-actions.utils', () => {
  it('应构建 2FA_ENABLED 的审计与通知 sideEffects', () => {
    const sideEffects = buildTwoFactorEnabledSideEffects({
      userId: 15,
      clientIp: '10.10.0.1',
    });

    expect(sideEffects).toEqual([
      {
        kind: 'audit',
        action: '2FA_ENABLED',
        payload: { userId: 15, ip: '10.10.0.1' },
      },
      {
        kind: 'notification',
        event: '2FA_ENABLED',
        payload: { userId: 15, ip: '10.10.0.1' },
      },
    ]);
  });

  it('应构建 2FA 激活成功动作并保持原状态码与文案语义', () => {
    const action = buildTwoFactorEnabledSuccessAction({
      userId: 21,
      clientIp: '127.0.0.1',
    });

    expect(action.response).toEqual({
      statusCode: 200,
      body: { message: '两步验证已成功激活！' },
    });
    expect(action.log).toEqual({
      level: 'info',
      message: '用户 21 已成功激活两步验证。',
    });
    expect(action.sideEffects).toEqual([
      {
        kind: 'audit',
        action: '2FA_ENABLED',
        payload: { userId: 21, ip: '127.0.0.1' },
      },
      {
        kind: 'notification',
        event: '2FA_ENABLED',
        payload: { userId: 21, ip: '127.0.0.1' },
      },
    ]);
  });
});
