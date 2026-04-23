import { describe, expect, it } from 'vitest';
import { ENABLE_TWO_FACTOR_SQL, toUnixSecondsTimestamp } from './auth-2fa-mutation-flow.utils';
import {
  buildTwoFactorVerifySuccessMutationAction,
  resolveTwoFactorVerifySuccessMutationResultAction,
} from './auth-two-factor-verify-success-actions.utils';

describe('auth-two-factor-verify-success-actions.utils', () => {
  it('应构建 verify-success mutation SQL 与参数', () => {
    const userId = 14;
    const secret = 'BASE32SECRET';
    const action = buildTwoFactorVerifySuccessMutationAction({ userId, secret });

    expect(action.sql).toBe(ENABLE_TWO_FACTOR_SQL);
    expect(action.params[0]).toBe(secret);
    expect(action.params[2]).toBe(userId);
    expect(action.params[1]).toBeTypeOf('number');
    expect(action.params[1]).toBeLessThanOrEqual(toUnixSecondsTimestamp(Date.now()));
  });

  it('changes 为 0 时应返回错误动作', () => {
    const action = resolveTwoFactorVerifySuccessMutationResultAction({
      changes: 0,
      userId: 7,
      clientIp: '127.0.0.1',
    });

    expect(action.ok).toBe(false);
    if (!action.ok) {
      expect(action.log).toEqual({
        level: 'error',
        message: '激活 2FA 错误: 更新影响行数为 0 - 用户 ID 7',
      });
      expect(action.error).toBeInstanceOf(Error);
      expect(action.error.message).toBe('未找到要更新的用户');
    }
  });

  it('changes 大于 0 时应返回成功动作', () => {
    const action = resolveTwoFactorVerifySuccessMutationResultAction({
      changes: 1,
      userId: 9,
      clientIp: '10.0.0.9',
    });

    expect(action).toEqual({
      ok: true,
      successAction: {
        response: {
          statusCode: 200,
          body: { message: '两步验证已成功激活！' },
        },
        log: {
          level: 'info',
          message: '用户 9 已成功激活两步验证。',
        },
        sideEffects: [
          {
            kind: 'audit',
            action: '2FA_ENABLED',
            payload: { userId: 9, ip: '10.0.0.9' },
          },
          {
            kind: 'notification',
            event: '2FA_ENABLED',
            payload: { userId: 9, ip: '10.0.0.9' },
          },
        ],
      },
    });
  });
});
