import type { AuditLogActionType } from '../types/audit.types';
import type { NotificationEvent } from '../types/notification.types';

type TwoFactorEnabledEvent = '2FA_ENABLED';

export interface TwoFactorEnabledAuditSideEffect {
  kind: 'audit';
  action: TwoFactorEnabledEvent;
  payload: {
    userId: number;
    ip: string;
  };
}

export interface TwoFactorEnabledNotificationSideEffect {
  kind: 'notification';
  event: TwoFactorEnabledEvent;
  payload: {
    userId: number;
    ip: string;
  };
}

export type TwoFactorEnabledSideEffect =
  | TwoFactorEnabledAuditSideEffect
  | TwoFactorEnabledNotificationSideEffect;

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
  const { userId, clientIp } = payload;

  const auditAction: AuditLogActionType = '2FA_ENABLED';
  const notificationEvent: NotificationEvent = '2FA_ENABLED';
  const effectPayload = {
    userId,
    ip: clientIp,
  };

  return [
    {
      kind: 'audit',
      action: auditAction,
      payload: effectPayload,
    },
    {
      kind: 'notification',
      event: notificationEvent,
      payload: effectPayload,
    },
  ];
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
