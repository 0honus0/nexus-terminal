import { describe, expect, it } from 'vitest';
import { buildSecuritySideEffects } from './auth-security-side-effects.utils';

describe('auth-security-side-effects.utils', () => {
  it('应统一构建 PASSWORD_CHANGED 事件 sideEffects', () => {
    const sideEffects = buildSecuritySideEffects({
      event: 'PASSWORD_CHANGED',
      userId: 1,
      clientIp: '127.0.0.1',
    });

    expect(sideEffects).toEqual([
      {
        kind: 'audit',
        action: 'PASSWORD_CHANGED',
        payload: { userId: 1, ip: '127.0.0.1' },
      },
      {
        kind: 'notification',
        event: 'PASSWORD_CHANGED',
        payload: { userId: 1, ip: '127.0.0.1' },
      },
    ]);
  });

  it('应统一构建 2FA_ENABLED/2FA_DISABLED 事件 sideEffects', () => {
    const enabled = buildSecuritySideEffects({
      event: '2FA_ENABLED',
      userId: 2,
      clientIp: '10.0.0.2',
    });
    const disabled = buildSecuritySideEffects({
      event: '2FA_DISABLED',
      userId: 3,
      clientIp: '10.0.0.3',
    });

    expect(enabled[0]).toEqual({
      kind: 'audit',
      action: '2FA_ENABLED',
      payload: { userId: 2, ip: '10.0.0.2' },
    });
    expect(disabled[1]).toEqual({
      kind: 'notification',
      event: '2FA_DISABLED',
      payload: { userId: 3, ip: '10.0.0.3' },
    });
  });
});
