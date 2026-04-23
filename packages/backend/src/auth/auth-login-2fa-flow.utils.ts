import crypto from 'crypto';
import { Request } from 'express';

export interface PendingAuth {
  tempToken: string;
  userId: number;
  username: string;
  expiresAt: number;
}

type Login2FAFailureResponse = {
  statusCode: 400 | 401;
  body: {
    message: string;
  };
};

const INVALID_PENDING_STATE_RESPONSE: Login2FAFailureResponse = {
  statusCode: 401,
  body: { message: '无效的认证状态。' },
};

const EXPIRED_PENDING_STATE_RESPONSE: Login2FAFailureResponse = {
  statusCode: 401,
  body: { message: '认证已过期，请重新登录。' },
};

const EMPTY_TOKEN_RESPONSE: Login2FAFailureResponse = {
  statusCode: 400,
  body: { message: '验证码不能为空。' },
};

const INVALID_TOKEN_FORMAT_RESPONSE: Login2FAFailureResponse = {
  statusCode: 400,
  body: { message: '验证码格式无效。' },
};

const normalizeTotpToken = (token: unknown): string => {
  if (typeof token !== 'string') {
    return '';
  }

  return token
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s-]/g, '')
    .trim();
};

export const createPendingLoginTwoFactorAuthState = (payload: {
  userId: number;
  username: string;
  tempTokenLength: number;
  pendingAuthTimeoutMs: number;
  now?: number;
  randomBytesFn?: (size: number) => Buffer;
}): PendingAuth => {
  const {
    userId,
    username,
    tempTokenLength,
    pendingAuthTimeoutMs,
    now = Date.now(),
    randomBytesFn = crypto.randomBytes,
  } = payload;
  const tempToken = randomBytesFn(tempTokenLength).toString('hex');

  return {
    tempToken,
    userId,
    username,
    expiresAt: now + pendingAuthTimeoutMs,
  };
};

export type LoginPendingAuthValidationResult =
  | {
      ok: true;
      pendingAuth: PendingAuth;
    }
  | {
      ok: false;
      reason: 'invalid_state' | 'expired';
      failure: Login2FAFailureResponse;
    };

export const resolveLoginPendingAuthValidation = (payload: {
  req: Request;
  tempToken: unknown;
  now?: number;
}): LoginPendingAuthValidationResult => {
  const { req, tempToken, now = Date.now() } = payload;
  const pendingAuth = req.session.pendingAuth as PendingAuth | undefined;

  if (!pendingAuth || !tempToken || pendingAuth.tempToken !== tempToken) {
    return {
      ok: false,
      reason: 'invalid_state',
      failure: INVALID_PENDING_STATE_RESPONSE,
    };
  }

  if (now > pendingAuth.expiresAt) {
    delete req.session.pendingAuth;
    return {
      ok: false,
      reason: 'expired',
      failure: EXPIRED_PENDING_STATE_RESPONSE,
    };
  }

  return {
    ok: true,
    pendingAuth,
  };
};

export type Login2FATokenValidationResult =
  | {
      ok: true;
      normalizedToken: string;
    }
  | {
      ok: false;
      failure: Login2FAFailureResponse;
    };

export const resolveLogin2FATokenValidation = (token: unknown): Login2FATokenValidationResult => {
  const normalizedToken = normalizeTotpToken(token);

  if (!normalizedToken) {
    return {
      ok: false,
      failure: EMPTY_TOKEN_RESPONSE,
    };
  }

  if (!/^\d{6,8}$/.test(normalizedToken)) {
    return {
      ok: false,
      failure: INVALID_TOKEN_FORMAT_RESPONSE,
    };
  }

  return {
    ok: true,
    normalizedToken,
  };
};

export const clearPendingLoginTwoFactorAuthState = (req: Request): boolean => {
  if (typeof req.session.pendingAuth === 'undefined') {
    return false;
  }

  delete req.session.pendingAuth;
  return true;
};
