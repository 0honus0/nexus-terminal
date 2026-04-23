import type { AuditLogActionType } from '../types/audit.types';
import type { NotificationEvent } from '../types/notification.types';

export type SecurityEvent = 'PASSWORD_CHANGED' | '2FA_DISABLED' | '2FA_ENABLED';

export interface SecurityAuditSideEffect {
  kind: 'audit';
  action: SecurityEvent;
  payload: {
    userId: number;
    ip: string;
  };
}

export interface SecurityNotificationSideEffect {
  kind: 'notification';
  event: SecurityEvent;
  payload: {
    userId: number;
    ip: string;
  };
}

export type SecuritySideEffect = SecurityAuditSideEffect | SecurityNotificationSideEffect;

export const buildSecuritySideEffects = (payload: {
  event: SecurityEvent;
  userId: number;
  clientIp: string;
}): SecuritySideEffect[] => {
  const { event, userId, clientIp } = payload;
  const effectPayload = {
    userId,
    ip: clientIp,
  };

  const auditAction: AuditLogActionType = event;
  const notificationEvent: NotificationEvent = event;

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
