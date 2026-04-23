import { describe, expect, it } from 'vitest';
import {
  buildDisableTwoFactorMutation,
  buildEnableTwoFactorMutation,
  createTwoFactorMutationNoRowsError,
  DISABLE_TWO_FACTOR_SQL,
  ENABLE_TWO_FACTOR_SQL,
  resolveTwoFactorMutationChangesValidation,
  toUnixSecondsTimestamp,
} from './auth-2fa-mutation-flow.utils';

describe('auth-2fa-mutation-flow.utils', () => {
  it('toUnixSecondsTimestamp 应按秒截断毫秒时间戳', () => {
    expect(toUnixSecondsTimestamp(1_712_345_678_901)).toBe(1_712_345_678);
  });

  it('buildEnableTwoFactorMutation 应构造启用 2FA 的 SQL 与参数', () => {
    const result = buildEnableTwoFactorMutation({
      secret: 'BASE32SECRET',
      userId: 7,
      nowMs: 1_712_345_678_901,
    });

    expect(result).toEqual({
      sql: ENABLE_TWO_FACTOR_SQL,
      params: ['BASE32SECRET', 1_712_345_678, 7],
      updatedAt: 1_712_345_678,
    });
  });

  it('buildDisableTwoFactorMutation 应构造禁用 2FA 的 SQL 与参数', () => {
    const result = buildDisableTwoFactorMutation({
      userId: 9,
      nowMs: 1_700_000_000_123,
    });

    expect(result).toEqual({
      sql: DISABLE_TWO_FACTOR_SQL,
      params: [1_700_000_000, 9],
      updatedAt: 1_700_000_000,
    });
  });

  it('changes===0 时应映射为“未找到要更新的用户”错误', () => {
    const result = resolveTwoFactorMutationChangesValidation({ changes: 0 });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toBeInstanceOf(Error);
    expect(result.error.message).toBe('未找到要更新的用户');
  });

  it('changes>0 时应视为成功', () => {
    const result = resolveTwoFactorMutationChangesValidation({ changes: 1 });

    expect(result).toEqual({ ok: true });
  });

  it('createTwoFactorMutationNoRowsError 应返回兼容文案的 Error', () => {
    const error = createTwoFactorMutationNoRowsError();

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('未找到要更新的用户');
  });
});
