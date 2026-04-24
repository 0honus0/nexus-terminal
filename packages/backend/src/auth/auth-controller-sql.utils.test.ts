import { describe, expect, it } from 'vitest';
import {
  buildInsertAdminUserMutationAction,
  buildLoginUserByUsernameQueryAction,
  buildUpdateUserPasswordMutationAction,
  buildUserPasswordByIdQueryAction,
  buildUsersCountQueryAction,
  buildUserTwoFactorSecretByIdQueryAction,
  INSERT_ADMIN_USER_SQL,
  LOGIN_USER_BY_USERNAME_SQL,
  toUnixSecondsTimestamp,
  UPDATE_USER_PASSWORD_SQL,
  USER_PASSWORD_BY_ID_SQL,
  USER_TWO_FACTOR_SECRET_BY_ID_SQL,
  USERS_COUNT_SQL,
} from './auth-controller-sql.utils';

describe('auth-controller-sql.utils', () => {
  it('toUnixSecondsTimestamp 应按秒截断毫秒时间戳', () => {
    expect(toUnixSecondsTimestamp(1_712_345_678_901)).toBe(1_712_345_678);
  });

  it('应构造 login 用户查询动作', () => {
    const action = buildLoginUserByUsernameQueryAction({ username: 'alice' });

    expect(action).toEqual({
      sql: LOGIN_USER_BY_USERNAME_SQL,
      params: ['alice'],
    });
  });

  it('应构造按 userId 查询 2FA 密钥动作', () => {
    const action = buildUserTwoFactorSecretByIdQueryAction({ userId: 7 });

    expect(action).toEqual({
      sql: USER_TWO_FACTOR_SECRET_BY_ID_SQL,
      params: [7],
    });
  });

  it('应构造按 userId 查询密码动作', () => {
    const action = buildUserPasswordByIdQueryAction({ userId: 9 });

    expect(action).toEqual({
      sql: USER_PASSWORD_BY_ID_SQL,
      params: [9],
    });
  });

  it('应构造密码更新 SQL 与参数顺序', () => {
    const action = buildUpdateUserPasswordMutationAction({
      hashedPassword: 'hashed-value',
      userId: 9,
      nowMs: 1_700_000_000_123,
    });

    expect(action).toEqual({
      sql: UPDATE_USER_PASSWORD_SQL,
      params: ['hashed-value', 1_700_000_000, 9],
      updatedAt: 1_700_000_000,
    });
  });

  it('应构造用户计数查询动作', () => {
    expect(buildUsersCountQueryAction()).toEqual({
      sql: USERS_COUNT_SQL,
    });
  });

  it('应构造 setupAdmin 的 INSERT 动作并复用同一秒级时间戳', () => {
    const action = buildInsertAdminUserMutationAction({
      username: 'admin',
      hashedPassword: 'hashed-admin',
      nowMs: 1_800_000_000_999,
    });

    expect(action).toEqual({
      sql: INSERT_ADMIN_USER_SQL,
      params: ['admin', 'hashed-admin', 1_800_000_000, 1_800_000_000],
      createdAt: 1_800_000_000,
      updatedAt: 1_800_000_000,
    });
  });
});
