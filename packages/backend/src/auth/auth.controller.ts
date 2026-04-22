import { Request, Response, NextFunction } from 'express';
import { getErrorMessage } from '../utils/AppError';
import crypto from 'crypto';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import { getDbInstance, runDb, getDb } from '../database/connection';
import { hashPassword, comparePassword } from '../utils/crypto';
import { NotificationService } from '../notifications/notification.service';
import { AuditLogService } from '../audit/audit.service';
import { ipBlacklistService } from './ip-blacklist.service';
import { captchaService } from './captcha.service';
import { settingsService } from '../settings/settings.service';
import { passkeyService } from '../passkey/passkey.service'; // +++ Passkey Service
import { passkeyRepository } from '../passkey/passkey.repository'; // +++ Passkey Repository
import { userRepository } from '../user/user.repository'; // For passkey auth success
import { SECURITY_CONFIG } from '../config/security.config';
import { getSingleHeaderToken } from '../utils/url';
import {
  resolveRequiresSetup,
  toPublicCaptchaConfig,
  resolveInitAuthState,
} from './auth-init-data.utils';
import {
  completeAuthenticatedSession,
  destroySessionAndRespondLogout,
  recordLoginFailureAttempt,
  recordLoginSuccessAttempt,
  resolveRequestClientIp,
  startPendingTwoFactorSession,
} from './auth-main-flow.utils';
import {
  completePasskeyAuthenticatedSession,
  recordPasskeyAuthenticationFailure,
  recordPasskeyAuthenticationSuccess,
  recordTwoFactorDisabledEvent,
  recordTwoFactorEnabledEvent,
} from './auth-passkey-2fa-flow.utils';

// 开发环境标志，用于控制调试日志输出
const isDev = process.env.NODE_ENV !== 'production';

const notificationService = new NotificationService();
const auditLogService = new AuditLogService();

const getRequestHeaderValue = (req: Request, name: string): string | undefined => {
  const headerFromGetter = typeof req.get === 'function' ? req.get(name) : undefined;
  if (typeof headerFromGetter === 'string') {
    return headerFromGetter;
  }

  const requestHeaders = (
    req as unknown as {
      headers?: Record<string, string | string[] | undefined>;
    }
  ).headers;
  if (!requestHeaders) {
    return undefined;
  }

  const rawHeader = requestHeaders[name.toLowerCase()];
  if (Array.isArray(rawHeader)) {
    return rawHeader[0];
  }

  return typeof rawHeader === 'string' ? rawHeader : undefined;
};

const getPasskeyRequestOrigin = (req: Request): string | undefined => {
  const originHeader = getSingleHeaderToken(getRequestHeaderValue(req, 'Origin'));
  if (originHeader) {
    return originHeader;
  }

  const host = getSingleHeaderToken(getRequestHeaderValue(req, 'Host'));
  const protocol = req.protocol;

  if (!host || !protocol) {
    return undefined;
  }

  return `${protocol}://${host}`;
};

const getVerificationErrorMessage = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return undefined;
  }

  const { error } = value as { error?: unknown };
  if (typeof error !== 'object' || error === null || !('message' in error)) {
    return undefined;
  }

  const { message } = error as { message?: unknown };
  return typeof message === 'string' ? message : undefined;
};

/**
 * 规范化 TOTP 验证码输入：
 * - 全角数字转半角
 * - 去除空格与连字符
 */
const normalizeTotpToken = (token: unknown): string => {
  if (typeof token !== 'string') {
    return '';
  }

  return token
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s-]/g, '')
    .trim();
};

const normalizeBase32Secret = (secret: unknown): string => {
  if (typeof secret !== 'string') {
    return '';
  }

  return secret.replace(/[\s-]/g, '').trim().toUpperCase();
};

const buildTwoFactorOtpAuthUrl = (username: string, secret: string): string =>
  speakeasy.otpauthURL({
    secret,
    encoding: 'base32',
    label: `NexusTerminal (${username})`,
    issuer: 'NexusTerminal',
  });

// 安全收紧：仅允许 ±30 秒（1 * 30 秒）时间窗口。
const TOTP_VERIFY_WINDOW = 1;
// 仅用于"时间偏差检测"的窗口，不用于放行登录/激活。
const TOTP_SKEW_DETECT_WINDOW = 20;
// 超过该阈值代表客户端时间明显漂移，记录告警便于排障。
const TOTP_SKEW_WARN_THRESHOLD = 2;

export interface User {
  id: number;
  username: string;
  hashed_password: string;
  two_factor_secret?: string | null;
}

// +++ Challenge Data with Timestamp for Replay Attack Prevention
interface ChallengeData {
  challenge: string;
  timestamp: number;
  origin?: string;
}

// +++ Pending Authentication for 2FA Bypass Prevention
interface PendingAuth {
  tempToken: string;
  userId: number;
  username: string;
  expiresAt: number;
}

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    username?: string;
    tempTwoFactorSecret?: string;
    requiresTwoFactor?: boolean;
    currentChallenge?: ChallengeData; // +++ Modified: Now stores challenge with timestamp
    passkeyUserHandle?: string; // +++ For Passkey user handle (user ID as string)
    rememberMe?: boolean;
    pendingAuth?: PendingAuth; // +++ For 2FA temporary authentication token
  }
}

// --- Passkey Controller Methods ---

/**
 * 生成 Passkey 注册选项 (POST /api/v1/auth/passkey/registration-options)
 */
export const generatePasskeyRegistrationOptionsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { userId } = req.session;
  const { username } = req.session;

  if (!userId || !username) {
    res.status(401).json({ message: '用户未认证。' });
    return;
  }

  try {
    const requestOrigin = getPasskeyRequestOrigin(req);

    // PasskeyService's generateRegistrationOptions expects userId as number
    const options = await passkeyService.generateRegistrationOptions(
      username,
      userId,
      requestOrigin
    );

    // +++ Store challenge with timestamp for replay attack prevention
    req.session.currentChallenge = {
      challenge: options.challenge,
      timestamp: Date.now(),
      origin: requestOrigin,
    };
    // The user.id from options is a Uint8Array. We need to store the original string userId for userHandle.
    req.session.passkeyUserHandle = userId.toString();

    // 显式保存 session 以确保 challenge 被持久化
    req.session.save((err) => {
      if (err) {
        console.error('[AuthController] 保存 session 失败:', err);
        return next(err);
      }
      console.debug(`[AuthController] Generated Passkey registration options for user ${username}`);
      res.json(options);
    });
  } catch (error: unknown) {
    console.error(`[AuthController] 生成 Passkey 注册选项时出错 (用户: ${username}):`, error);
    next(error);
  }
};

/**
 * 验证并保存新的 Passkey (POST /api/v1/auth/passkey/register)
 */
export const verifyPasskeyRegistrationHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const registrationResponse = req.body; // The whole body is the response from @simplewebauthn/browser
  const challengeData = req.session.currentChallenge;
  const userHandle = req.session.passkeyUserHandle;

  if (!registrationResponse) {
    res.status(400).json({ message: '注册响应不能为空。' });
    return;
  }
  if (!challengeData) {
    res.status(400).json({ message: '会话中未找到质询信息，请重试注册流程。' });
    return;
  }
  if (!userHandle) {
    res.status(400).json({ message: '会话中未找到用户句柄，请重试注册流程。' });
    return;
  }

  // +++ Verify challenge timestamp (5 minutes validity)
  if (Date.now() - challengeData.timestamp > SECURITY_CONFIG.CHALLENGE_TIMEOUT) {
    delete req.session.currentChallenge;
    delete req.session.passkeyUserHandle;
    res.status(400).json({ message: '注册质询已过期，请重新开始注册流程。' });
    return;
  }

  const expectedChallenge = challengeData.challenge;
  const requestOrigin = challengeData.origin || getPasskeyRequestOrigin(req);

  try {
    const verification = await passkeyService.verifyRegistration(
      registrationResponse,
      expectedChallenge,
      userHandle, // userHandle is userId as string
      requestOrigin
    );

    if (verification.verified && verification.newPasskeyToSave) {
      await passkeyRepository.createPasskey(verification.newPasskeyToSave);
      const userIdNum = parseInt(userHandle, 10);
      console.info(
        `[AuthController] 用户 ${userHandle} 的 Passkey 注册成功并已保存。 CredentialID: ${verification.newPasskeyToSave.credential_id.substring(0, 8)}***`
      );
      auditLogService.logAction('PASSKEY_REGISTERED', {
        userId: userIdNum,
        credentialId: verification.newPasskeyToSave.credential_id,
      });
      notificationService.sendNotification('PASSKEY_REGISTERED', {
        userId: userIdNum,
        username: req.session.username,
        credentialId: verification.newPasskeyToSave.credential_id,
      });

      delete req.session.currentChallenge;
      delete req.session.passkeyUserHandle;
      res.status(201).json({ verified: true, message: 'Passkey 注册成功。' });
    } else {
      console.warn(`[AuthController] Passkey 注册验证失败 (用户: ${userHandle}):`, verification);
      res.status(400).json({
        verified: false,
        message: 'Passkey 注册验证失败。',
        error: getVerificationErrorMessage(verification) || 'Unknown verification error',
      });
    }
  } catch (error: unknown) {
    console.error(`[AuthController] 验证 Passkey 注册时出错 (用户: ${userHandle}):`, error);
    next(error);
  }
};

/**
 * 生成 Passkey 认证选项 (POST /api/v1/auth/passkey/authentication-options)
 */
export const generatePasskeyAuthenticationOptionsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { username } = req.body; // Can be initiated by username (if not logged in) or for currently logged-in user

  try {
    const requestOrigin = getPasskeyRequestOrigin(req);

    // PasskeyService's generateAuthenticationOptions can optionally take a username
    const options = await passkeyService.generateAuthenticationOptions(username, requestOrigin);

    // +++ Store challenge with timestamp for replay attack prevention
    req.session.currentChallenge = {
      challenge: options.challenge,
      timestamp: Date.now(),
      origin: requestOrigin,
    };
    // For authentication, userHandle is not strictly needed in session beforehand if RP ID is specific enough
    // or if allowCredentials is used. We'll clear any old one just in case.
    delete req.session.passkeyUserHandle;

    // 显式保存 session 以确保 challenge 被持久化并设置 cookie
    // 这对于新 session（用户未登录时）尤为重要
    req.session.save((err) => {
      if (err) {
        console.error('[AuthController] 保存 session 失败:', err);
        return next(err);
      }
      console.debug(
        `[AuthController] Generated Passkey authentication options (username: ${username || 'any'})`
      );
      res.json(options);
    });
  } catch (error: unknown) {
    console.error(
      `[AuthController] 生成 Passkey 认证选项时出错 (username: ${username || 'any'}):`,
      error
    );
    next(error);
  }
};

/**
 * 验证 Passkey 凭据并登录用户 (POST /api/v1/auth/passkey/authenticate)
 */
export const verifyPasskeyAuthenticationHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Extract assertionResponse and rememberMe from the request body
  const { assertionResponse, rememberMe } = req.body;
  const challengeData = req.session.currentChallenge;

  // Rename assertionResponse to authenticationResponseJSON for clarity within this scope
  const authenticationResponseJSON = assertionResponse;

  if (!authenticationResponseJSON) {
    res.status(400).json({ message: '认证响应 (assertionResponse) 不能为空。' });
    return;
  }
  if (!challengeData) {
    res.status(400).json({ message: '会话中未找到质询信息，请重试认证流程。' });
    return;
  }

  // +++ Verify challenge timestamp (5 minutes validity)
  if (Date.now() - challengeData.timestamp > SECURITY_CONFIG.CHALLENGE_TIMEOUT) {
    delete req.session.currentChallenge;
    res.status(400).json({ message: '认证质询已过期，请重新开始认证流程。' });
    return;
  }

  const expectedChallenge = challengeData.challenge;
  const requestOrigin = challengeData.origin || getPasskeyRequestOrigin(req);

  try {
    // Pass the extracted authenticationResponseJSON to the service
    const verification = await passkeyService.verifyAuthentication(
      authenticationResponseJSON,
      expectedChallenge,
      requestOrigin
    );

    if (verification.verified && verification.userId && verification.passkey) {
      const user = await userRepository.findUserById(verification.userId);
      if (!user) {
        // This should ideally not happen if passkey verification was successful
        console.error(`[AuthController] Passkey 认证成功但未找到用户 ID: ${verification.userId}`);
        recordPasskeyAuthenticationFailure(
          { auditLogService, notificationService },
          {
            req,
            credentialId: verification.passkey.credential_id,
            reason: 'User not found after verification',
          }
        );
        res.status(401).json({ verified: false, message: 'Passkey 认证失败：用户数据错误。' });
        return;
      }

      console.info(
        `[AuthController] 用户 ${user.username} (ID: ${user.id}) 通过 Passkey (ID: ***${verification.passkey.id.toString().substring(verification.passkey.id.toString().length - 4)}) 认证成功。`
      );
      recordPasskeyAuthenticationSuccess(
        { auditLogService, notificationService },
        {
          req,
          userId: user.id,
          username: user.username,
          credentialId: verification.passkey.credential_id,
        }
      );
      completePasskeyAuthenticatedSession(req, res, {
        user: { id: user.id, username: user.username },
        rememberMe,
      });
    } else {
      console.warn(`[AuthController] Passkey 认证验证失败:`, verification);
      recordPasskeyAuthenticationFailure(
        { auditLogService, notificationService },
        {
          req,
          credentialId: authenticationResponseJSON?.id || 'unknown',
          reason: 'Verification failed',
        }
      );
      res.status(401).json({ verified: false, message: 'Passkey 认证失败。' });
    }
  } catch (error: unknown) {
    console.error(`[AuthController] 验证 Passkey 认证时出错:`, error);
    recordPasskeyAuthenticationFailure(
      { auditLogService, notificationService },
      {
        req,
        credentialId: authenticationResponseJSON?.id || 'unknown',
        reason: getErrorMessage(error) || 'Unknown error',
      }
    );
    next(error);
  }
};

/**
 * 获取当前认证用户的所有 Passkey (GET /api/v1/user/passkeys)
 */
export const listUserPasskeysHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { userId } = req.session;
  const { username } = req.session;

  if (!userId || !username) {
    res.status(401).json({ message: '用户未认证。' });
    return;
  }

  try {
    const passkeys = await passkeyService.listPasskeysByUserId(userId);
    console.debug(
      `[AuthController] 用户 ${username} (ID: ${userId}) 获取了 Passkey 列表，数量: ${passkeys.length}`
    );
    res.status(200).json(passkeys);
  } catch (error: unknown) {
    console.error(
      `[AuthController] 用户 ${username} (ID: ${userId}) 获取 Passkey 列表时出错:`,
      error
    );
    next(error);
  }
};

/**
 * 删除当前认证用户指定的 Passkey (DELETE /api/v1/user/passkeys/:credentialID)
 */
export const deleteUserPasskeyHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { userId } = req.session;
  const { username } = req.session;
  const { credentialID } = req.params;

  if (!userId || !username) {
    res.status(401).json({ message: '用户未认证。' });
    return;
  }

  if (!credentialID) {
    res.status(400).json({ message: '必须提供 Passkey 的 CredentialID。' });
    return;
  }

  try {
    const wasDeleted = await passkeyService.deletePasskey(userId, credentialID);
    if (wasDeleted) {
      console.info(
        `[AuthController] 用户 ${username} (ID: ${userId}) 成功删除了 Passkey (CredentialID: ${credentialID.substring(0, 8)}***)。`
      );
      auditLogService.logAction('PASSKEY_DELETED', {
        userId,
        username,
        credentialId: credentialID,
      });
      notificationService.sendNotification('PASSKEY_DELETED', {
        userId,
        username,
        credentialId: credentialID,
      });
      res.status(200).json({ message: 'Passkey 删除成功。' });
    } else {
      // 这通常不应该发生，因为 service 层会在找不到或权限不足时抛出错误
      console.warn(
        `[AuthController] 用户 ${username} (ID: ${userId}) 删除 Passkey (CredentialID: ${credentialID.substring(0, 8)}***) 失败，但未抛出错误。`
      );
      res.status(404).json({ message: 'Passkey 未找到或无法删除。' });
    }
  } catch (error: unknown) {
    console.error(
      `[AuthController] 用户 ${username} (ID: ${userId}) 删除 Passkey (CredentialID: ${credentialID.substring(0, 8)}***) 时出错:`,
      getErrorMessage(error),
      (error as Error)?.stack
    );
    if (getErrorMessage(error) === 'Passkey not found.') {
      res.status(404).json({ message: '指定的 Passkey 未找到。' });
    } else if (getErrorMessage(error) === 'Unauthorized to delete this passkey.') {
      auditLogService.logAction('PASSKEY_DELETE_UNAUTHORIZED', {
        userId,
        username,
        credentialIdAttempted: credentialID,
      });
      res.status(403).json({ message: '无权删除此 Passkey。' });
    } else {
      next(error);
    }
  }
};

/**
 * 更新当前认证用户指定的 Passkey 名称 (PUT /api/v1/user/passkeys/:credentialID/name)
 */
export const updateUserPasskeyNameHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { userId } = req.session;
  const { username } = req.session;
  const { credentialID } = req.params;
  const { name } = req.body;

  if (!userId || !username) {
    res.status(401).json({ message: '用户未认证。' });
    return;
  }

  if (!credentialID) {
    res.status(400).json({ message: '必须提供 Passkey 的 CredentialID。' });
    return;
  }

  if (typeof name !== 'string' || name.trim() === '') {
    res.status(400).json({ message: 'Passkey 名称不能为空。' });
    return;
  }

  const trimmedName = name.trim();

  try {
    await passkeyService.updatePasskeyName(userId, credentialID, trimmedName);
    console.info(
      `[AuthController] 用户 ${username} (ID: ${userId}) 成功更新了 Passkey (CredentialID: ${credentialID.substring(0, 8)}***) 的名称为 "${trimmedName}"。`
    );
    auditLogService.logAction('PASSKEY_NAME_UPDATED', {
      userId,
      username,
      credentialId: credentialID,
      newName: trimmedName,
    });
    // Optionally send a notification if desired
    // notificationService.sendNotification('PASSKEY_NAME_UPDATED', { userId, username, credentialId: credentialID, newName: trimmedName });
    res.status(200).json({ message: 'Passkey 名称更新成功。' });
  } catch (error: unknown) {
    console.error(
      `[AuthController] 用户 ${username} (ID: ${userId}) 更新 Passkey (CredentialID: ${credentialID.substring(0, 8)}***) 名称时出错:`,
      getErrorMessage(error),
      (error as Error)?.stack
    );
    if (getErrorMessage(error) === 'Passkey not found.') {
      res.status(404).json({ message: '指定的 Passkey 未找到。' });
    } else if (getErrorMessage(error) === 'Unauthorized to update this passkey name.') {
      auditLogService.logAction('PASSKEY_NAME_UPDATE_UNAUTHORIZED', {
        userId,
        username,
        credentialIdAttempted: credentialID,
      });
      res.status(403).json({ message: '无权更新此 Passkey 名称。' });
    } else {
      next(error);
    }
  }
};

/**
 * 处理用户登录请求 (POST /api/v1/auth/login)
 */
export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  // 从请求体中解构 username, password 和可选的 rememberMe
  const { username, password, rememberMe } = req.body;

  if (!username || !password) {
    res.status(400).json({ message: '用户名和密码不能为空。' });
    return;
  }

  try {
    // --- CAPTCHA Verification Step ---
    const captchaConfig = await settingsService.getCaptchaConfig();
    if (captchaConfig.enabled) {
      const { captchaToken } = req.body;
      if (!captchaToken) {
        res.status(400).json({ message: '需要提供 CAPTCHA 令牌。' });
        return;
      }
      try {
        const isCaptchaValid = await captchaService.verifyToken(captchaToken);
        if (!isCaptchaValid) {
          console.debug(`[AuthController] 登录尝试失败: CAPTCHA 验证失败 - ${username}`);
          const clientIp = resolveRequestClientIp(req);
          recordLoginFailureAttempt(
            { ipBlacklistService, auditLogService, notificationService },
            {
              username,
              reason: 'Invalid CAPTCHA token',
              clientIp,
            }
          );
          res.status(401).json({ message: 'CAPTCHA 验证失败。' });
          return;
        }
        console.debug(`[AuthController] CAPTCHA 验证成功 - ${username}`);
      } catch (captchaError: unknown) {
        console.error(
          `[AuthController] CAPTCHA 验证过程中出错 (${username}):`,
          getErrorMessage(captchaError)
        );
        res.status(500).json({ message: 'CAPTCHA 验证服务出错，请稍后重试或检查配置。' });
        return;
      }
    } else {
      console.debug(`[AuthController] CAPTCHA 未启用，跳过验证 - ${username}`);
    }

    const db = await getDbInstance();
    const user = await getDb<User>(
      db,
      'SELECT id, username, hashed_password, two_factor_secret FROM users WHERE username = ?',
      [username]
    );

    if (!user) {
      console.debug(`登录尝试失败: 用户未找到 - ${username}`);
      const clientIp = resolveRequestClientIp(req);
      recordLoginFailureAttempt(
        { ipBlacklistService, auditLogService, notificationService },
        {
          username,
          reason: 'User not found',
          clientIp,
        }
      );
      res.status(401).json({ message: '无效的凭据。' });
      return;
    }

    const isMatch = await comparePassword(password, user.hashed_password);

    if (!isMatch) {
      console.debug(`登录尝试失败: 密码错误 - ${username}`);
      const clientIp = resolveRequestClientIp(req);
      recordLoginFailureAttempt(
        { ipBlacklistService, auditLogService, notificationService },
        {
          username,
          reason: 'Invalid password',
          clientIp,
        }
      );
      res.status(401).json({ message: '无效的凭据。' });
      return;
    }

    // 检查是否启用了 2FA
    if (user.two_factor_secret) {
      console.debug(`用户 ${username} 已启用 2FA，需要进行二次验证。`);
      // +++ Generate temporary token for 2FA verification
      const tempToken = crypto.randomBytes(SECURITY_CONFIG.TEMP_TOKEN_LENGTH).toString('hex');
      const pendingAuth: PendingAuth = {
        tempToken,
        userId: user.id,
        username: user.username,
        expiresAt: Date.now() + SECURITY_CONFIG.PENDING_AUTH_TIMEOUT,
      };
      startPendingTwoFactorSession(req, res, { pendingAuth, rememberMe, isDev });
    } else {
      console.info(`登录成功 (无 2FA): ${username}`);
      const clientIp = resolveRequestClientIp(req);
      recordLoginSuccessAttempt(
        { ipBlacklistService, auditLogService, notificationService },
        { userId: user.id, username, clientIp }
      );
      completeAuthenticatedSession(req, res, {
        user: { id: user.id, username: user.username },
        rememberMe,
        saveErrorMessage: '登录过程中发生错误，请重试。',
      });
    }
  } catch (error: unknown) {
    console.error('登录时出错:', error);
    next(error);
  }
};

/**
 * 获取当前用户的认证状态 (GET /api/v1/auth/status)
 */
export const getAuthStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { userId } = req.session;
  const { username } = req.session;

  if (!userId || !username || req.session.requiresTwoFactor) {
    res.status(401).json({ isAuthenticated: false });
    return;
  }

  try {
    const db = await getDbInstance();
    const user = await getDb<{ two_factor_secret: string | null }>(
      db,
      'SELECT two_factor_secret FROM users WHERE id = ?',
      [userId]
    );

    if (!user) {
      res.status(401).json({ isAuthenticated: false });
      return;
    }

    res.status(200).json({
      isAuthenticated: true,
      user: {
        id: userId,
        username,
        isTwoFactorEnabled: !!user.two_factor_secret,
      },
    });
  } catch (error: unknown) {
    console.error(`获取用户 ${userId} 状态时发生内部错误:`, error);
    next(error);
  }
};
/**
 * 处理登录时的 2FA 验证 (POST /api/v1/auth/login/2fa)
 */
export const verifyLogin2FA = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { token, tempToken } = req.body; // +++ Accept tempToken from frontend
  const pendingAuth = req.session.pendingAuth as PendingAuth | undefined;
  const normalizedToken = normalizeTotpToken(token);

  // +++ Debug logging for session diagnostics (dev only)
  if (isDev) {
    const getHeaderValue = (name: string): string | undefined => {
      return getRequestHeaderValue(req, name);
    };

    console.debug(`[AuthController] verifyLogin2FA - Has pendingAuth: ${!!pendingAuth}`);
    console.debug(`[AuthController] verifyLogin2FA - Has tempToken: ${!!tempToken}`);
    console.debug(
      `[AuthController] verifyLogin2FA - X-Forwarded-Proto: ${getHeaderValue('X-Forwarded-Proto') ?? ''}`
    );
  }

  // +++ Validate pending authentication state and tempToken
  if (!pendingAuth || !tempToken) {
    if (isDev) {
      console.debug(
        `[AuthController] verifyLogin2FA - FAILED: pendingAuth=${!!pendingAuth}, tempToken=${!!tempToken}`
      );
    }
    res.status(401).json({ message: '无效的认证状态。' });
    return;
  }

  if (pendingAuth.tempToken !== tempToken) {
    res.status(401).json({ message: '无效的认证状态。' });
    return;
  }

  // +++ Verify tempToken hasn't expired (5 minutes)
  if (Date.now() > pendingAuth.expiresAt) {
    delete req.session.pendingAuth;
    res.status(401).json({ message: '认证已过期，请重新登录。' });
    return;
  }

  if (!normalizedToken) {
    res.status(400).json({ message: '验证码不能为空。' });
    return;
  }

  if (!/^\d{6,8}$/.test(normalizedToken)) {
    res.status(400).json({ message: '验证码格式无效。' });
    return;
  }

  try {
    const db = await getDbInstance();
    // +++ Use pendingAuth.userId instead of session.userId
    const user = await getDb<User>(
      db,
      'SELECT id, username, two_factor_secret FROM users WHERE id = ?',
      [pendingAuth.userId]
    );

    if (!user || !user.two_factor_secret) {
      console.error(`2FA 验证错误: 未找到用户 ${pendingAuth.userId} 或未设置密钥。`);
      res.status(400).json({ message: '无法验证，请重新登录。' });
      return;
    }

    const verificationDelta = speakeasy.totp.verifyDelta({
      secret: user.two_factor_secret,
      encoding: 'base32',
      token: normalizedToken,
      window: TOTP_VERIFY_WINDOW,
    });
    const verified = verificationDelta !== undefined;

    if (verified) {
      const delta = verificationDelta?.delta ?? 0;
      if (Math.abs(delta) > TOTP_SKEW_WARN_THRESHOLD) {
        console.warn(
          `[AuthController] 用户 ${user.username} 的 2FA 登录验证码存在明显时间偏差（delta=${delta}），建议校准客户端时间。`
        );
      }
      console.info(`用户 ${user.username} 2FA 验证成功。`);
      const clientIp = resolveRequestClientIp(req);
      recordLoginSuccessAttempt(
        { ipBlacklistService, auditLogService, notificationService },
        { userId: user.id, username: user.username, clientIp, twoFactor: true }
      );

      // 保存 rememberMe 状态，因为 regenerate 会清空 session
      const { rememberMe } = req.session;

      // +++ Clear pending authentication after successful verification
      delete req.session.pendingAuth;

      completeAuthenticatedSession(req, res, {
        user: { id: user.id, username: user.username },
        rememberMe,
        saveErrorMessage: '登录完成失败，请重试。',
      });
    } else {
      const relaxedDelta = speakeasy.totp.verifyDelta({
        secret: user.two_factor_secret,
        encoding: 'base32',
        token: normalizedToken,
        window: TOTP_SKEW_DETECT_WINDOW,
      });
      if (relaxedDelta && Math.abs(relaxedDelta.delta) >= TOTP_SKEW_WARN_THRESHOLD) {
        const skewSeconds = Math.abs(relaxedDelta.delta) * 30;
        console.warn(
          `[AuthController] 用户 ${user.username} 的 2FA 登录验证码存在明显时间偏差（delta=${relaxedDelta.delta}），建议校准客户端时间。`
        );
        res.status(401).json({
          message: `验证码无效。检测到客户端时间与服务器存在约 ${skewSeconds} 秒偏差，请校准设备时间后重试。`,
          code: 'TIME_SKEW_DETECTED',
          skewSeconds,
          delta: relaxedDelta.delta,
        });
        return;
      }

      console.debug(`用户 ${user.username} 2FA 验证失败: 验证码错误。`);
      const clientIp = resolveRequestClientIp(req);
      recordLoginFailureAttempt(
        { ipBlacklistService, auditLogService, notificationService },
        {
          userId: user.id,
          username: user.username,
          reason: 'Invalid 2FA token',
          clientIp,
        }
      );
      res.status(401).json({ message: '验证码无效。' });
    }
  } catch (error: unknown) {
    console.error(`2FA 验证时发生内部错误 (用户: ${pendingAuth?.userId || 'unknown'}):`, error);
    next(error);
  }
};

/**
 * 处理修改密码请求 (PUT /api/v1/auth/password)
 */
export const changePassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { currentPassword, newPassword } = req.body;
  const { userId } = req.session;

  if (!userId || req.session.requiresTwoFactor) {
    res.status(401).json({ message: '用户未认证或认证未完成，请先登录。' });
    return;
  }

  if (!currentPassword || !newPassword) {
    res.status(400).json({ message: '当前密码和新密码不能为空。' });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ message: '新密码长度至少需要 8 位。' });
    return;
  }
  if (currentPassword === newPassword) {
    res.status(400).json({ message: '新密码不能与当前密码相同。' });
    return;
  }

  try {
    const db = await getDbInstance();
    const user = await getDb<User>(db, 'SELECT id, hashed_password FROM users WHERE id = ?', [
      userId,
    ]);

    if (!user) {
      console.error(`修改密码错误: 未找到 ID 为 ${userId} 的用户。`);
      res.status(404).json({ message: '用户不存在。' });
      return;
    }

    const isMatch = await comparePassword(currentPassword, user.hashed_password);
    if (!isMatch) {
      console.debug(`修改密码尝试失败: 当前密码错误 - 用户 ID ${userId}`);
      res.status(400).json({ message: '当前密码不正确。' });
      return;
    }

    const newHashedPassword = await hashPassword(newPassword);
    const now = Math.floor(Date.now() / 1000);

    const result = await runDb(
      db,
      'UPDATE users SET hashed_password = ?, updated_at = ? WHERE id = ?',
      [newHashedPassword, now, userId]
    );

    if (result.changes === 0) {
      console.error(`修改密码错误: 更新影响行数为 0 - 用户 ID ${userId}`);
      throw new Error('未找到要更新的用户');
    }

    console.info(`用户 ${userId} 密码已成功修改。`);
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    auditLogService.logAction('PASSWORD_CHANGED', { userId, ip: clientIp });
    notificationService.sendNotification('PASSWORD_CHANGED', { userId, ip: clientIp });

    res.status(200).json({ message: '密码已成功修改。' });
  } catch (error: unknown) {
    console.error(`修改用户 ${userId} 密码时发生内部错误:`, error);
    next(error);
  }
};

/**
 * 开始 2FA 设置流程 (POST /api/v1/auth/2fa/setup)
 * 生成临时密钥和二维码
 */
export const setup2FA = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { userId } = req.session;
  const { username } = req.session;

  if (!userId || !username || req.session.requiresTwoFactor) {
    res.status(401).json({ message: '用户未认证或认证未完成。' });
    return;
  }

  try {
    const db = await getDbInstance();
    const user = await getDb<{ two_factor_secret: string | null }>(
      db,
      'SELECT two_factor_secret FROM users WHERE id = ?',
      [userId]
    );
    const existingSecret = user ? user.two_factor_secret : null;

    if (existingSecret) {
      res.status(400).json({ message: '两步验证已启用。如需重置，请先禁用。' });
      return;
    }

    // 会话中已有临时密钥时直接复用，避免并发 setup 导致前端展示密钥与后端校验密钥不一致。
    const sessionTempSecret = req.session.tempTwoFactorSecret;
    if (sessionTempSecret) {
      const qrCodeUrl = await qrcode.toDataURL(
        buildTwoFactorOtpAuthUrl(username, sessionTempSecret)
      );
      res.json({
        secret: sessionTempSecret,
        qrCodeUrl,
      });
      return;
    }

    const secret = speakeasy.generateSecret({
      length: 20,
      name: `NexusTerminal (${username})`,
    });

    req.session.tempTwoFactorSecret = secret.base32;

    const qrCodeUrl = await qrcode.toDataURL(buildTwoFactorOtpAuthUrl(username, secret.base32));

    // 显式保存 session，确保 tempTwoFactorSecret 在 verify 阶段可见
    req.session.save((saveErr) => {
      if (saveErr) {
        console.error(`[AuthController] 用户 ${userId} 保存临时 2FA 密钥到 session 失败:`, saveErr);
        res.status(500).json({ message: '保存两步验证状态失败，请重试。' });
        return;
      }

      res.json({
        secret: secret.base32,
        qrCodeUrl,
      });
    });
  } catch (error: unknown) {
    console.error(`用户 ${userId} 设置 2FA 时出错:`, error);
    next(error);
  }
};

/**
 * 验证并激活 2FA (POST /api/v1/auth/2fa/verify)
 */
export const verifyAndActivate2FA = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { token, secret: secretFromBody } = req.body as { token?: unknown; secret?: unknown };
  const { userId } = req.session;
  const tempSecret = normalizeBase32Secret(req.session.tempTwoFactorSecret);
  const providedSecret = normalizeBase32Secret(secretFromBody);
  const normalizedToken = normalizeTotpToken(token);

  if (!userId || req.session.requiresTwoFactor) {
    res.status(401).json({ message: '用户未认证或认证未完成。' });
    return;
  }

  const effectiveSecret = providedSecret || tempSecret;

  if (!effectiveSecret) {
    res.status(400).json({ message: '未找到临时密钥，请重新开始设置流程。' });
    return;
  }

  if (!normalizedToken) {
    res.status(400).json({ message: '验证码不能为空。' });
    return;
  }

  if (!/^\d{6,8}$/.test(normalizedToken)) {
    res.status(400).json({ message: '验证码格式无效。' });
    return;
  }

  try {
    if (providedSecret && tempSecret && providedSecret !== tempSecret) {
      // 兼容并发/重复 setup 导致会话临时密钥与页面展示密钥不一致的场景。
      console.warn(
        `[AuthController] 用户 ${userId} 的 2FA 临时密钥与前端提交密钥不一致，优先使用前端提交密钥进行校验。`
      );
    }

    if (providedSecret && req.session.tempTwoFactorSecret !== providedSecret) {
      req.session.tempTwoFactorSecret = providedSecret;
    }

    const db = await getDbInstance();
    const verificationDelta = speakeasy.totp.verifyDelta({
      secret: effectiveSecret,
      encoding: 'base32',
      token: normalizedToken,
      window: TOTP_VERIFY_WINDOW,
    });
    const verified = verificationDelta !== undefined;

    if (verified) {
      const delta = verificationDelta?.delta ?? 0;
      if (Math.abs(delta) > TOTP_SKEW_WARN_THRESHOLD) {
        console.warn(
          `[AuthController] 用户 ${userId} 的 2FA 激活验证码存在明显时间偏差（delta=${delta}），建议校准客户端时间。`
        );
      }
      const now = Math.floor(Date.now() / 1000);
      const result = await runDb(
        db,
        'UPDATE users SET two_factor_secret = ?, updated_at = ? WHERE id = ?',
        [effectiveSecret, now, userId]
      );

      if (result.changes === 0) {
        console.error(`激活 2FA 错误: 更新影响行数为 0 - 用户 ID ${userId}`);
        throw new Error('未找到要更新的用户');
      }

      console.info(`用户 ${userId} 已成功激活两步验证。`);
      recordTwoFactorEnabledEvent({ auditLogService, notificationService }, { req, userId });

      delete req.session.tempTwoFactorSecret;

      res.status(200).json({ message: '两步验证已成功激活！' });
    } else {
      const relaxedDelta = speakeasy.totp.verifyDelta({
        secret: effectiveSecret,
        encoding: 'base32',
        token: normalizedToken,
        window: TOTP_SKEW_DETECT_WINDOW,
      });
      if (relaxedDelta && Math.abs(relaxedDelta.delta) >= TOTP_SKEW_WARN_THRESHOLD) {
        const skewSeconds = Math.abs(relaxedDelta.delta) * 30;
        console.warn(
          `[AuthController] 用户 ${userId} 的 2FA 激活验证码存在明显时间偏差（delta=${relaxedDelta.delta}），建议校准客户端时间。`
        );
        res.status(400).json({
          message: `验证码无效。检测到客户端时间与服务器存在约 ${skewSeconds} 秒偏差，请校准设备时间后重试。`,
          code: 'TIME_SKEW_DETECTED',
          skewSeconds,
          delta: relaxedDelta.delta,
        });
        return;
      }

      console.debug(`用户 ${userId} 2FA 激活失败: 验证码错误。`);
      res.status(400).json({ message: '验证码无效。' });
    }
  } catch (error: unknown) {
    console.error(`用户 ${userId} 验证并激活 2FA 时出错:`, error);
    next(error);
  }
};

/**
 * 禁用 2FA (DELETE /api/v1/auth/2fa)
 */
export const disable2FA = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { userId } = req.session;
  const { password } = req.body;

  if (!userId || req.session.requiresTwoFactor) {
    res.status(401).json({ message: '用户未认证或认证未完成。' });
    return;
  }

  if (!password) {
    res.status(400).json({ message: '需要提供当前密码才能禁用两步验证。' });
    return;
  }

  try {
    const db = await getDbInstance();
    const user = await getDb<User>(db, 'SELECT id, hashed_password FROM users WHERE id = ?', [
      userId,
    ]);

    if (!user) {
      res.status(404).json({ message: '用户不存在。' });
      return;
    }
    const isMatch = await comparePassword(password, user.hashed_password);
    if (!isMatch) {
      res.status(400).json({ message: '当前密码不正确。' });
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const result = await runDb(
      db,
      'UPDATE users SET two_factor_secret = NULL, updated_at = ? WHERE id = ?',
      [now, userId]
    );

    if (result.changes === 0) {
      console.error(`禁用 2FA 错误: 更新影响行数为 0 - 用户 ID ${userId}`);
      throw new Error('未找到要更新的用户');
    }

    console.info(`用户 ${userId} 已成功禁用两步验证。`);
    recordTwoFactorDisabledEvent({ auditLogService, notificationService }, { req, userId });

    // 禁用时清理临时密钥，避免后续重新启用时读取到陈旧状态。
    delete req.session.tempTwoFactorSecret;

    res.status(200).json({ message: '两步验证已成功禁用。' });
  } catch (error: unknown) {
    console.error(`用户 ${userId} 禁用 2FA 时出错:`, error);
    next(error);
  }
};

/**
 * 检查是否需要进行初始设置 (GET /api/v1/auth/needs-setup)
 * 如果数据库中没有用户，则需要设置。
 */
export const needsSetup = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const db = await getDbInstance();
    const row = await getDb<{ count: number }>(db, 'SELECT COUNT(*) as count FROM users');
    const userCount = row ? row.count : 0;

    res.status(200).json({ needsSetup: userCount === 0 });
  } catch (error: unknown) {
    console.error('检查设置状态时发生内部错误:', error);
    next(error);
  }
};

/**
 * 处理初始账号设置请求 (POST /api/v1/auth/setup)
 */
export const setupAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { username, password, confirmPassword } = req.body;

  if (!username || !password || !confirmPassword) {
    res.status(400).json({ message: '用户名、密码和确认密码不能为空。' });
    return;
  }
  if (password !== confirmPassword) {
    res.status(400).json({ message: '两次输入的密码不匹配。' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ message: '密码长度至少需要 8 位。' });
    return;
  }

  try {
    const db = await getDbInstance();
    const row = await getDb<{ count: number }>(db, 'SELECT COUNT(*) as count FROM users');
    const userCount = row ? row.count : 0;

    if (userCount > 0) {
      console.warn('尝试在已有用户的情况下执行初始设置。');
      res.status(403).json({ message: '设置已完成，无法重复执行。' });
      return;
    }

    const hashedPassword = await hashPassword(password);
    const now = Math.floor(Date.now() / 1000);

    const result = await runDb(
      db,
      `INSERT INTO users (username, hashed_password, created_at, updated_at)
             VALUES (?, ?, ?, ?)`,
      [username, hashedPassword, now, now]
    );

    if (typeof result.lastID !== 'number' || result.lastID <= 0) {
      console.error(
        '创建初始账号后未能获取有效的 lastID。可能原因：用户名已存在或其他数据库错误。'
      );
      throw new Error('创建初始账号失败，可能用户名已存在。');
    }
    const newUser = { id: result.lastID };

    console.info(`初始账号 '${username}' (ID: ${newUser.id}) 已成功创建。`);
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    auditLogService.logAction('ADMIN_SETUP_COMPLETE', {
      userId: newUser.id,
      username,
      ip: clientIp,
    });
    notificationService.sendNotification('ADMIN_SETUP_COMPLETE', {
      userId: newUser.id,
      username,
      ip: clientIp,
    });

    res.status(201).json({ message: '初始账号创建成功！' });
  } catch (error: unknown) {
    console.error('初始设置过程中发生内部错误:', error);
    next(error);
  }
};

/**
 * 处理用户登出请求 (POST /api/v1/auth/logout)
 */
export const logout = (req: Request, res: Response): void => {
  const { userId } = req.session;
  const { username } = req.session;
  destroySessionAndRespondLogout(req, res, {
    userId,
    username,
    onLogoutSuccess: (clientIp) => {
      auditLogService.logAction('LOGOUT', { userId, username, ip: clientIp });
      notificationService.sendNotification('LOGOUT', { userId, username, ip: clientIp });
    },
  });
};

/**
 * 获取公共 CAPTCHA 配置 (GET /api/v1/auth/captcha/config)
 * 返回给前端用于显示 CAPTCHA 小部件所需的信息 (不含密钥)。
 */
export const getPublicCaptchaConfig = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    console.debug('[AuthController] Received request for public CAPTCHA config.');
    const fullConfig = await settingsService.getCaptchaConfig();
    const publicConfig = toPublicCaptchaConfig(fullConfig);

    console.debug('[AuthController] Sending public CAPTCHA config to client:', publicConfig);
    res.status(200).json(publicConfig);
  } catch (error: unknown) {
    console.error('[AuthController] 获取公共 CAPTCHA 配置时出错:', error);
    next(error);
  }
};

/**
 * 统一初始化端点 (GET /api/v1/auth/init)
 * 合并多个初始化检查，减少前端网络请求次数，提升应用启动速度
 * 返回: needsSetup, isAuthenticated, user, captchaConfig
 */
export const getInitData = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const db = await getDbInstance();

    // 1. 检查是否需要初始设置
    const requiresSetup = await resolveRequiresSetup(db);

    // 2. 检查认证状态
    const { isAuthenticated, user } = await resolveInitAuthState(db, req.session);

    // 3. 获取公共 CAPTCHA 配置
    const fullCaptchaConfig = await settingsService.getCaptchaConfig();
    const captchaConfig = toPublicCaptchaConfig(fullCaptchaConfig);

    // 4. 返回统一的初始化数据
    res.status(200).json({
      needsSetup: requiresSetup,
      isAuthenticated,
      user,
      captchaConfig,
    });

    console.debug(
      `[AuthController] 初始化数据已发送: needsSetup=${requiresSetup}, isAuthenticated=${isAuthenticated}`
    );
  } catch (error: unknown) {
    console.error('[AuthController] 获取初始化数据时出错:', error);
    next(error);
  }
};

/**
 * 检查系统中是否配置了任何 Passkey (GET /api/v1/auth/passkey/has-configured)
 * 或者特定用户是否配置了 Passkey (GET /api/v1/auth/passkey/has-configured?username=xxx)
 * 公开访问，用于登录页面判断是否显示 Passkey 登录按钮。
 */
export const checkHasPasskeys = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const username = req.query.username as string | undefined;
  try {
    const hasPasskeys = await passkeyService.hasPasskeysConfigured(username);
    res.status(200).json({ hasPasskeys });
  } catch (error: unknown) {
    console.error(
      `[AuthController] 检查 Passkey 配置状态时出错 (username: ${username || 'any'}):`,
      getErrorMessage(error)
    );
    next(error);
  }
};
