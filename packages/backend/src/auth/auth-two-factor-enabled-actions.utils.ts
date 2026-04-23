import {
  buildSecuritySideEffects,
  type SecuritySideEffect,
} from './auth-security-side-effects.utils';

export type TwoFactorEnabledSideEffect = SecuritySideEffect;

export interface TwoFactorEnabledSuccessAction {
  response: {
    statusCode: 200;
    body: {
      message: string;
    };
  };
  log: {
    level: 'info';
    message: string;
  };
  sideEffects: TwoFactorEnabledSideEffect[];
}

export const buildTwoFactorEnabledSideEffects = (payload: {
  userId: number;
  clientIp: string;
}): TwoFactorEnabledSideEffect[] => {
  return buildSecuritySideEffects({
    event: '2FA_ENABLED',
    userId: payload.userId,
    clientIp: payload.clientIp,
  });
};

export const buildTwoFactorEnabledSuccessAction = (payload: {
  userId: number;
  clientIp: string;
}): TwoFactorEnabledSuccessAction => {
  const { userId, clientIp } = payload;

  return {
    response: {
      statusCode: 200,
      body: { message: '两步验证已成功激活！' },
    },
    log: {
      level: 'info',
      message: `用户 ${userId} 已成功激活两步验证。`,
    },
    sideEffects: buildTwoFactorEnabledSideEffects({
      userId,
      clientIp,
    }),
  };
};
