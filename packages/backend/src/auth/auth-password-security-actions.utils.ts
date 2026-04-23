import {
  buildSecuritySideEffects,
  type SecurityEvent,
  type SecuritySideEffect,
} from './auth-security-side-effects.utils';

type PasswordSecurityEvent = Exclude<SecurityEvent, '2FA_ENABLED'>;

export type PasswordSecuritySideEffect = SecuritySideEffect;

export interface PasswordSecuritySuccessAction {
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
  sideEffects: PasswordSecuritySideEffect[];
}

export const buildPasswordSecuritySideEffects = (payload: {
  event: PasswordSecurityEvent;
  userId: number;
  clientIp: string;
}): PasswordSecuritySideEffect[] => {
  return buildSecuritySideEffects(payload);
};

export const buildChangePasswordSuccessAction = (payload: {
  userId: number;
  clientIp: string;
}): PasswordSecuritySuccessAction => {
  const { userId, clientIp } = payload;

  return {
    response: {
      statusCode: 200,
      body: { message: '密码已成功修改。' },
    },
    log: {
      level: 'info',
      message: `用户 ${userId} 密码已成功修改。`,
    },
    sideEffects: buildPasswordSecuritySideEffects({
      event: 'PASSWORD_CHANGED',
      userId,
      clientIp,
    }),
  };
};

export const buildDisableTwoFactorSuccessAction = (payload: {
  userId: number;
  clientIp: string;
}): PasswordSecuritySuccessAction => {
  const { userId, clientIp } = payload;

  return {
    response: {
      statusCode: 200,
      body: { message: '两步验证已成功禁用。' },
    },
    log: {
      level: 'info',
      message: `用户 ${userId} 已成功禁用两步验证。`,
    },
    sideEffects: buildPasswordSecuritySideEffects({
      event: '2FA_DISABLED',
      userId,
      clientIp,
    }),
  };
};
