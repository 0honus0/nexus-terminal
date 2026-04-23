import {
  ENABLE_TWO_FACTOR_SQL,
  buildEnableTwoFactorMutation,
  resolveTwoFactorMutationChangesValidation,
} from './auth-2fa-mutation-flow.utils';
import {
  buildTwoFactorEnabledSuccessAction,
  type TwoFactorEnabledSuccessAction,
} from './auth-two-factor-enabled-actions.utils';

export const buildTwoFactorVerifySuccessMutationAction = (payload: {
  secret: string;
  userId: number;
}): {
  sql: typeof ENABLE_TWO_FACTOR_SQL;
  params: [string, number, number];
} => {
  const mutation = buildEnableTwoFactorMutation({
    secret: payload.secret,
    userId: payload.userId,
  });
  return {
    sql: mutation.sql,
    params: mutation.params,
  };
};

export type TwoFactorVerifySuccessMutationResultAction =
  | {
      ok: false;
      error: Error;
      log: {
        level: 'error';
        message: string;
      };
    }
  | {
      ok: true;
      successAction: TwoFactorEnabledSuccessAction;
    };

export const resolveTwoFactorVerifySuccessMutationResultAction = (payload: {
  changes: number;
  userId: number;
  clientIp: string;
}): TwoFactorVerifySuccessMutationResultAction => {
  const { changes, userId, clientIp } = payload;
  const validation = resolveTwoFactorMutationChangesValidation({ changes });
  if (!validation.ok) {
    return {
      ok: false,
      error: validation.error,
      log: {
        level: 'error',
        message: `激活 2FA 错误: 更新影响行数为 0 - 用户 ID ${userId}`,
      },
    };
  }

  return {
    ok: true,
    successAction: buildTwoFactorEnabledSuccessAction({
      userId,
      clientIp,
    }),
  };
};
