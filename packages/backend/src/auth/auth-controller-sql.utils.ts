export const LOGIN_USER_BY_USERNAME_SQL =
  'SELECT id, username, hashed_password, two_factor_secret FROM users WHERE username = ?';

export const USER_TWO_FACTOR_SECRET_BY_ID_SQL = 'SELECT two_factor_secret FROM users WHERE id = ?';

export const USER_PASSWORD_BY_ID_SQL = 'SELECT id, hashed_password FROM users WHERE id = ?';

export const UPDATE_USER_PASSWORD_SQL =
  'UPDATE users SET hashed_password = ?, updated_at = ? WHERE id = ?';

export const USERS_COUNT_SQL = 'SELECT COUNT(*) as count FROM users';

export const INSERT_ADMIN_USER_SQL =
  'INSERT INTO users (username, hashed_password, created_at, updated_at) VALUES (?, ?, ?, ?)';

export const toUnixSecondsTimestamp = (nowMs: number = Date.now()): number =>
  Math.floor(nowMs / 1000);

export const buildLoginUserByUsernameQueryAction = (payload: {
  username: string;
}): {
  sql: typeof LOGIN_USER_BY_USERNAME_SQL;
  params: [string];
} => ({
  sql: LOGIN_USER_BY_USERNAME_SQL,
  params: [payload.username],
});

export const buildUserTwoFactorSecretByIdQueryAction = (payload: {
  userId: number | undefined;
}): {
  sql: typeof USER_TWO_FACTOR_SECRET_BY_ID_SQL;
  params: [number | undefined];
} => ({
  sql: USER_TWO_FACTOR_SECRET_BY_ID_SQL,
  params: [payload.userId],
});

export const buildUserPasswordByIdQueryAction = (payload: {
  userId: number;
}): {
  sql: typeof USER_PASSWORD_BY_ID_SQL;
  params: [number];
} => ({
  sql: USER_PASSWORD_BY_ID_SQL,
  params: [payload.userId],
});

export const buildUpdateUserPasswordMutationAction = (payload: {
  hashedPassword: string;
  userId: number;
  nowMs?: number;
}): {
  sql: typeof UPDATE_USER_PASSWORD_SQL;
  params: [string, number, number];
  updatedAt: number;
} => {
  const updatedAt = toUnixSecondsTimestamp(payload.nowMs);

  return {
    sql: UPDATE_USER_PASSWORD_SQL,
    params: [payload.hashedPassword, updatedAt, payload.userId],
    updatedAt,
  };
};

export const buildUsersCountQueryAction = (): {
  sql: typeof USERS_COUNT_SQL;
} => ({
  sql: USERS_COUNT_SQL,
});

export const buildInsertAdminUserMutationAction = (payload: {
  username: string;
  hashedPassword: string;
  nowMs?: number;
}): {
  sql: typeof INSERT_ADMIN_USER_SQL;
  params: [string, string, number, number];
  createdAt: number;
  updatedAt: number;
} => {
  const createdAt = toUnixSecondsTimestamp(payload.nowMs);
  const updatedAt = createdAt;

  return {
    sql: INSERT_ADMIN_USER_SQL,
    params: [payload.username, payload.hashedPassword, createdAt, updatedAt],
    createdAt,
    updatedAt,
  };
};
