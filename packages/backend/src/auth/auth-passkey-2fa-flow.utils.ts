import { Request, Response } from 'express';
import { SECURITY_CONFIG } from '../config/security.config';
import { AuditLogActionType } from '../types/audit.types';
import { NotificationEvent } from '../types/notification.types';
import { resolveRequestClientIp } from './auth-main-flow.utils';

interface AuthEventServices {
  auditLogService: {
    logAction: (
      action: AuditLogActionType,
      payload?: Record<string, unknown> | string | null
    ) => Promise<void> | void;
  };
  notificationService: {
    sendNotification: (
      event: NotificationEvent,
      payload?: Record<string, unknown> | string
    ) => Promise<void> | void;
  };
}

export const recordPasskeyAuthenticationSuccess = (
  services: AuthEventServices,
  payload: {
    req: Request;
    userId: number;
    username: string;
    credentialId: string;
  }
): void => {
  const { req, userId, username, credentialId } = payload;
  const clientIp = resolveRequestClientIp(req);

  services.auditLogService.logAction('PASSKEY_AUTH_SUCCESS', {
    userId,
    username,
    credentialId,
    ip: clientIp,
  });
  services.notificationService.sendNotification('LOGIN_SUCCESS', {
    userId,
    username,
    ip: clientIp,
    method: 'Passkey',
  });
};

export const recordPasskeyAuthenticationFailure = (
  services: AuthEventServices,
  payload: {
    req: Request;
    credentialId: string;
    reason: string;
  }
): void => {
  const { req, credentialId, reason } = payload;
  const clientIp = resolveRequestClientIp(req);

  services.auditLogService.logAction('PASSKEY_AUTH_FAILURE', {
    credentialId,
    reason,
    ip: clientIp,
  });
  services.notificationService.sendNotification('PASSKEY_AUTH_FAILURE', {
    credentialId,
    reason,
    ip: clientIp,
  });
};

export const completePasskeyAuthenticatedSession = (
  req: Request,
  res: Response,
  payload: {
    user: {
      id: number;
      username: string;
    };
    rememberMe?: boolean;
  }
): void => {
  const { user, rememberMe } = payload;

  req.session.regenerate((err) => {
    if (err) {
      console.error('Passkey 认证后会话重新生成失败:', err);
      res.status(500).json({ message: 'Passkey 认证成功但会话创建失败，请重试。' });
      return;
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.requiresTwoFactor = false;
    req.session.cookie.maxAge = rememberMe ? SECURITY_CONFIG.SESSION_COOKIE_MAX_AGE : undefined;

    delete req.session.currentChallenge;
    delete req.session.passkeyUserHandle;

    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('Passkey 认证后会话保存失败:', saveErr);
        res.status(500).json({ message: 'Passkey 认证成功但会话创建失败，请重试。' });
        return;
      }

      res.status(200).json({
        verified: true,
        message: 'Passkey 认证成功。',
        user: { id: user.id, username: user.username },
      });
    });
  });
};

export const recordTwoFactorEnabledEvent = (
  services: AuthEventServices,
  payload: {
    req: Request;
    userId: number;
  }
): void => {
  const { req, userId } = payload;
  const clientIp = resolveRequestClientIp(req);
  services.auditLogService.logAction('2FA_ENABLED', { userId, ip: clientIp });
  services.notificationService.sendNotification('2FA_ENABLED', { userId, ip: clientIp });
};

export const recordTwoFactorDisabledEvent = (
  services: AuthEventServices,
  payload: {
    req: Request;
    userId: number;
  }
): void => {
  const { req, userId } = payload;
  const clientIp = resolveRequestClientIp(req);
  services.auditLogService.logAction('2FA_DISABLED', { userId, ip: clientIp });
  services.notificationService.sendNotification('2FA_DISABLED', { userId, ip: clientIp });
};
