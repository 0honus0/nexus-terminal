export const ENABLE_TWO_FACTOR_SQL =
  'UPDATE users SET two_factor_secret = ?, updated_at = ? WHERE id = ?';

export const DISABLE_TWO_FACTOR_SQL =
  'UPDATE users SET two_factor_secret = NULL, updated_at = ? WHERE id = ?';

export const toUnixSecondsTimestamp = (nowMs: number = Date.now()): number =>
  Math.floor(nowMs / 1000);

export const buildEnableTwoFactorMutation = (payload: {
  secret: string;
  userId: number;
  nowMs?: number;
}): {
  sql: typeof ENABLE_TWO_FACTOR_SQL;
  params: [string, number, number];
  updatedAt: number;
} => {
  const { secret, userId, nowMs } = payload;
  const updatedAt = toUnixSecondsTimestamp(nowMs);

  return {
    sql: ENABLE_TWO_FACTOR_SQL,
    params: [secret, updatedAt, userId],
    updatedAt,
  };
};

export const buildDisableTwoFactorMutation = (payload: {
  userId: number;
  nowMs?: number;
}): {
  sql: typeof DISABLE_TWO_FACTOR_SQL;
  params: [number, number];
  updatedAt: number;
} => {
  const { userId, nowMs } = payload;
  const updatedAt = toUnixSecondsTimestamp(nowMs);

  return {
    sql: DISABLE_TWO_FACTOR_SQL,
    params: [updatedAt, userId],
    updatedAt,
  };
};

export const createTwoFactorMutationNoRowsError = (): Error => new Error('未找到要更新的用户');

export const resolveTwoFactorMutationChangesValidation = (payload: {
  changes: number;
}):
  | {
      ok: true;
    }
  | {
      ok: false;
      error: Error;
    } => {
  if (payload.changes === 0) {
    return {
      ok: false,
      error: createTwoFactorMutationNoRowsError(),
    };
  }

  return { ok: true };
};
