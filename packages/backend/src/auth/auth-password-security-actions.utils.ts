import type { AuditLogActionType } from '../types/audit.types';
import type { NotificationEvent } from '../types/notification.types';

type PasswordSecurityEvent = 'PASSWORD_CHANGED' | '2FA_DISABLED';

export interface PasswordSecurityAuditSideEffect {
  kind: 'audit';
  action: PasswordSecurityEvent;
  payload: {
    userId: number;
    ip: string;
  };
}

export interface PasswordSecurityNotificationSideEffect {
  kind: 'notification';
  event: PasswordSecurityEvent;
  payload: {
    userId: number;
    ip: string;
  };
}

export type PasswordSecuritySideEffect =
  | PasswordSecurityAuditSideEffect
  | PasswordSecurityNotificationSideEffect;

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
  const { event, userId, clientIp } = payload;

  const auditAction: AuditLogActionType = event;
  const notificationEvent: NotificationEvent = event;
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
