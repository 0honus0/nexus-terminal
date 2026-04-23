import { Request, Response, NextFunction } from 'express';
import { getErrorMessage } from '../utils/AppError';
import speakeasy from 'speakeasy';
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
  recordTwoFactorEnabledEvent,
} from './auth-passkey-2fa-flow.utils';
import {
  createTwoFactorSecret,
  resolveTwoFactorEffectiveSecret,
  respondWithExistingTwoFactorSetup,
  verifyTwoFactorTokenWithSkew,
} from './auth-two-factor-flow.utils';
import {
  mapTwoFactorVerifyFailure,
  resolveTwoFactorSetupRequestValidation,
  resolveTwoFactorVerifyRequestValidation,
  saveTwoFactorSetupSessionSecret,
} from './auth-2fa-state-flow.utils';
import {
  type ChallengeData,
  persistPasskeyChallengeSession,
  resolvePasskeyAuthenticationContext,
  resolvePasskeyCredentialId,
  resolvePasskeyRegistrationContext,
} from './auth-passkey-flow.utils';
import {
  resolvePasskeyAuthenticatedActor,
  resolvePasskeyCredentialId as resolvePasskeyManagementCredentialId,
  resolvePasskeyTrimmedName,
} from './auth-passkey-management-flow.utils';
import {
  buildDeletePasskeyResultAction,
  buildListPasskeysSuccessAction,
  buildUpdatePasskeyNameSuccessAction,
  type PasskeyManagementSideEffect,
  resolveDeletePasskeyErrorAction,
  resolveUpdatePasskeyNameErrorAction,
} from './auth-passkey-management-actions.utils';
import {
  createPendingLoginTwoFactorAuthState,
  type PendingAuth,
  resolveLogin2FATokenValidation,
  resolveLoginPendingAuthValidation,
} from './auth-login-2fa-flow.utils';
import {
  buildAuthStatusHttpResponse,
  buildInitDataBaseResponse,
  isAuthenticatedSessionSnapshot,
} from './auth-init-status-flow.utils';
import {
  clearPasskeyAuthenticationChallengeSession,
  clearPasskeyRegistrationSession,
  resolvePasskeyAuthenticationVerificationOutcome,
  resolvePasskeyRegistrationVerificationOutcome,
} from './auth-passkey-register-auth-flow.utils';
import {
  resolveChangePasswordAccessValidation,
  resolveChangePasswordInputValidation,
  resolveCurrentPasswordMatchValidation,
  resolveDisable2FAAccessValidation,
  resolveDisable2FAInputValidation,
  resolveMutationChangesValidation,
  resolvePasswordActionUserValidation,
} from './auth-password-disable2fa-flow.utils';
import {
  buildChangePasswordSuccessAction,
  buildDisableTwoFactorSuccessAction,
  type PasswordSecuritySideEffect,
} from './auth-password-security-actions.utils';
import {
  buildDisableTwoFactorMutation,
  buildEnableTwoFactorMutation,
  resolveTwoFactorMutationChangesValidation,
} from './auth-2fa-mutation-flow.utils';

// 开发环境标志，用于控制调试日志输出
const isDev = process.env.NODE_ENV !== 'production';

const notificationService = new NotificationService();
const auditLogService = new AuditLogService();

const applyPasskeyManagementSideEffects = (sideEffects: PasskeyManagementSideEffect[]): void => {
  for (const sideEffect of sideEffects) {
    if (sideEffect.kind === 'audit') {
      auditLogService.logAction(sideEffect.action, sideEffect.payload);
      continue;
    }

    notificationService.sendNotification(sideEffect.event, sideEffect.payload);
  }
};

const applyPasswordSecuritySideEffects = (sideEffects: PasswordSecuritySideEffect[]): void => {
  for (const sideEffect of sideEffects) {
    if (sideEffect.kind === 'audit') {
      auditLogService.logAction(sideEffect.action, sideEffect.payload);
      continue;
    }

    notificationService.sendNotification(sideEffect.event, sideEffect.payload);
  }
};

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

    await persistPasskeyChallengeSession(req, {
      challenge: options.challenge,
      origin: requestOrigin,
      // user.id from options is Uint8Array; session stores original string userId as userHandle.
      userHandle: userId.toString(),
    });

    console.debug(`[AuthController] Generated Passkey registration options for user ${username}`);
    res.json(options);
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
  const registrationContext = resolvePasskeyRegistrationContext({
    req,
    registrationResponse: req.body,
    fallbackOrigin: getPasskeyRequestOrigin(req),
  });
  if (!registrationContext.ok) {
    if (registrationContext.failure.body.message === '注册质询已过期，请重新开始注册流程。') {
      clearPasskeyRegistrationSession(req);
    }
    res.status(registrationContext.failure.statusCode).json(registrationContext.failure.body);
    return;
  }

  try {
    const verification = await passkeyService.verifyRegistration(
      registrationContext.registrationResponse as Parameters<
        typeof passkeyService.verifyRegistration
      >[0],
      registrationContext.expectedChallenge,
      registrationContext.userHandle,
      registrationContext.requestOrigin
    );
    const verificationResult = resolvePasskeyRegistrationVerificationOutcome(verification);

    if (verificationResult.status === 'verified') {
      await passkeyRepository.createPasskey(verificationResult.newPasskeyToSave);
      const userIdNum = parseInt(registrationContext.userHandle, 10);
      console.info(
        `[AuthController] 用户 ${registrationContext.userHandle} 的 Passkey 注册成功并已保存。 CredentialID: ${verificationResult.newPasskeyToSave.credential_id.substring(0, 8)}***`
      );
      auditLogService.logAction('PASSKEY_REGISTERED', {
        userId: userIdNum,
        credentialId: verificationResult.newPasskeyToSave.credential_id,
      });
      notificationService.sendNotification('PASSKEY_REGISTERED', {
        userId: userIdNum,
        username: req.session.username,
        credentialId: verificationResult.newPasskeyToSave.credential_id,
      });

      clearPasskeyRegistrationSession(req);
      res.status(201).json({ verified: true, message: 'Passkey 注册成功。' });
    } else {
      console.warn(
        `[AuthController] Passkey 注册验证失败 (用户: ${registrationContext.userHandle}):`,
        verification
      );
      res.status(400).json(verificationResult.responseBody);
    }
  } catch (error: unknown) {
    console.error(
      `[AuthController] 验证 Passkey 注册时出错 (用户: ${registrationContext.userHandle}):`,
      error
    );
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

    await persistPasskeyChallengeSession(req, {
      challenge: options.challenge,
      origin: requestOrigin,
      clearUserHandle: true,
    });

    console.debug(
      `[AuthController] Generated Passkey authentication options (username: ${username || 'any'})`
    );
    res.json(options);
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
  const { assertionResponse, rememberMe } = req.body;
  const authenticationContext = resolvePasskeyAuthenticationContext({
    req,
    assertionResponse,
    fallbackOrigin: getPasskeyRequestOrigin(req),
  });
  if (!authenticationContext.ok) {
    if (authenticationContext.failure.body.message === '认证质询已过期，请重新开始认证流程。') {
      clearPasskeyAuthenticationChallengeSession(req);
    }
    res.status(authenticationContext.failure.statusCode).json(authenticationContext.failure.body);
    return;
  }

  try {
    const verification = await passkeyService.verifyAuthentication(
      authenticationContext.authenticationResponseJSON as Parameters<
        typeof passkeyService.verifyAuthentication
      >[0],
      authenticationContext.expectedChallenge,
      authenticationContext.requestOrigin
    );
    const verificationResult = resolvePasskeyAuthenticationVerificationOutcome(verification);

    if (verificationResult.status === 'verified') {
      const user = await userRepository.findUserById(verificationResult.userId);
      if (!user) {
        // This should ideally not happen if passkey verification was successful
        console.error(
          `[AuthController] Passkey 认证成功但未找到用户 ID: ${verificationResult.userId}`
        );
        recordPasskeyAuthenticationFailure(
          { auditLogService, notificationService },
          {
            req,
            credentialId: verificationResult.passkey.credential_id,
            reason: 'User not found after verification',
          }
        );
        res.status(401).json({ verified: false, message: 'Passkey 认证失败：用户数据错误。' });
        return;
      }

      console.info(
        `[AuthController] 用户 ${user.username} (ID: ${user.id}) 通过 Passkey (ID: ***${verificationResult.passkey.id.toString().substring(verificationResult.passkey.id.toString().length - 4)}) 认证成功。`
      );
      recordPasskeyAuthenticationSuccess(
        { auditLogService, notificationService },
        {
          req,
          userId: user.id,
          username: user.username,
          credentialId: verificationResult.passkey.credential_id,
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
          credentialId:
            resolvePasskeyCredentialId(authenticationContext.authenticationResponseJSON) ||
            'unknown',
          reason: 'Verification failed',
        }
      );
      res.status(401).json(verificationResult.responseBody);
    }
  } catch (error: unknown) {
    console.error(`[AuthController] 验证 Passkey 认证时出错:`, error);
    recordPasskeyAuthenticationFailure(
      { auditLogService, notificationService },
      {
        req,
        credentialId:
          resolvePasskeyCredentialId(authenticationContext.authenticationResponseJSON) || 'unknown',
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
  const actorResult = resolvePasskeyAuthenticatedActor(req);
  if (!actorResult.ok) {
    res.status(actorResult.failure.statusCode).json(actorResult.failure.body);
    return;
  }
  const { userId, username } = actorResult.actor;

  try {
    const passkeys = await passkeyService.listPasskeysByUserId(userId);
    const listAction = buildListPasskeysSuccessAction({ userId, username }, passkeys);
    console[listAction.log.level](listAction.log.message);
    res.status(listAction.response.statusCode).json(listAction.response.body);
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
  const actorResult = resolvePasskeyAuthenticatedActor(req);
  if (!actorResult.ok) {
    res.status(actorResult.failure.statusCode).json(actorResult.failure.body);
    return;
  }
  const { userId, username } = actorResult.actor;

  const credentialResult = resolvePasskeyManagementCredentialId(req.params.credentialID);
  if (!credentialResult.ok) {
    res.status(credentialResult.failure.statusCode).json(credentialResult.failure.body);
    return;
  }
  const { credentialId } = credentialResult;

  try {
    const wasDeleted = await passkeyService.deletePasskey(userId, credentialId);
    const deleteAction = buildDeletePasskeyResultAction(
      { userId, username },
      credentialId,
      wasDeleted
    );
    console[deleteAction.log.level](deleteAction.log.message);
    applyPasskeyManagementSideEffects(deleteAction.sideEffects);
    res.status(deleteAction.response.statusCode).json(deleteAction.response.body);
  } catch (error: unknown) {
    const deleteErrorAction = resolveDeletePasskeyErrorAction(
      { userId, username },
      credentialId,
      error
    );
    console[deleteErrorAction.log.level](
      deleteErrorAction.log.message,
      deleteErrorAction.log.errorMessage,
      deleteErrorAction.log.errorStack
    );
    if (!deleteErrorAction.handled) {
      next(error);
      return;
    }
    applyPasskeyManagementSideEffects(deleteErrorAction.sideEffects);
    res.status(deleteErrorAction.response.statusCode).json(deleteErrorAction.response.body);
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
  const actorResult = resolvePasskeyAuthenticatedActor(req);
  if (!actorResult.ok) {
    res.status(actorResult.failure.statusCode).json(actorResult.failure.body);
    return;
  }
  const { userId, username } = actorResult.actor;

  const credentialResult = resolvePasskeyManagementCredentialId(req.params.credentialID);
  if (!credentialResult.ok) {
    res.status(credentialResult.failure.statusCode).json(credentialResult.failure.body);
    return;
  }
  const { credentialId } = credentialResult;

  const nameResult = resolvePasskeyTrimmedName(req.body?.name);
  if (!nameResult.ok) {
    res.status(nameResult.failure.statusCode).json(nameResult.failure.body);
    return;
  }
  const { trimmedName } = nameResult;

  try {
    await passkeyService.updatePasskeyName(userId, credentialId, trimmedName);
    const updateAction = buildUpdatePasskeyNameSuccessAction(
      { userId, username },
      credentialId,
      trimmedName
    );
    console[updateAction.log.level](updateAction.log.message);
    applyPasskeyManagementSideEffects(updateAction.sideEffects);
    res.status(updateAction.response.statusCode).json(updateAction.response.body);
  } catch (error: unknown) {
    const updateErrorAction = resolveUpdatePasskeyNameErrorAction(
      { userId, username },
      credentialId,
      error
    );
    console[updateErrorAction.log.level](
      updateErrorAction.log.message,
      updateErrorAction.log.errorMessage,
      updateErrorAction.log.errorStack
    );
    if (!updateErrorAction.handled) {
      next(error);
      return;
    }
    applyPasskeyManagementSideEffects(updateErrorAction.sideEffects);
    res.status(updateErrorAction.response.statusCode).json(updateErrorAction.response.body);
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
      const pendingAuth = createPendingLoginTwoFactorAuthState({
        userId: user.id,
        username: user.username,
        tempTokenLength: SECURITY_CONFIG.TEMP_TOKEN_LENGTH,
        pendingAuthTimeoutMs: SECURITY_CONFIG.PENDING_AUTH_TIMEOUT,
      });
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

  if (!isAuthenticatedSessionSnapshot(req.session)) {
    res.status(401).json({ isAuthenticated: false });
    return;
  }
  const authenticatedUserId = userId as number;
  const authenticatedUsername = username as string;

  try {
    const db = await getDbInstance();
    const user = await getDb<{ two_factor_secret: string | null }>(
      db,
      'SELECT two_factor_secret FROM users WHERE id = ?',
      [authenticatedUserId]
    );

    const authState = user
      ? {
          isAuthenticated: true,
          user: {
            id: authenticatedUserId,
            username: authenticatedUsername,
            isTwoFactorEnabled: !!user.two_factor_secret,
          },
        }
      : {
          isAuthenticated: false,
          user: null,
        };
    const response = buildAuthStatusHttpResponse(authState);
    res.status(response.statusCode).json(response.body);
  } catch (error: unknown) {
    console.error(`获取用户 ${authenticatedUserId} 状态时发生内部错误:`, error);
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

  const pendingValidationResult = resolveLoginPendingAuthValidation({
    req,
    tempToken,
  });
  if (!pendingValidationResult.ok) {
    if (isDev && !pendingAuth) {
      console.debug(
        `[AuthController] verifyLogin2FA - FAILED: pendingAuth=${!!pendingAuth}, tempToken=${!!tempToken}`
      );
    }
    res
      .status(pendingValidationResult.failure.statusCode)
      .json(pendingValidationResult.failure.body);
    return;
  }
  const { pendingAuth: verifiedPendingAuth } = pendingValidationResult;

  const tokenValidationResult = resolveLogin2FATokenValidation(token);
  if (!tokenValidationResult.ok) {
    res.status(tokenValidationResult.failure.statusCode).json(tokenValidationResult.failure.body);
    return;
  }
  const { normalizedToken } = tokenValidationResult;

  try {
    const db = await getDbInstance();
    // +++ Use pendingAuth.userId instead of session.userId
    const user = await getDb<User>(
      db,
      'SELECT id, username, two_factor_secret FROM users WHERE id = ?',
      [verifiedPendingAuth.userId]
    );

    if (!user || !user.two_factor_secret) {
      console.error(`2FA 验证错误: 未找到用户 ${verifiedPendingAuth.userId} 或未设置密钥。`);
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
    console.error(
      `2FA 验证时发生内部错误 (用户: ${verifiedPendingAuth?.userId || 'unknown'}):`,
      error
    );
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
  const accessValidation = resolveChangePasswordAccessValidation({
    userId: req.session.userId,
    requiresTwoFactor: req.session.requiresTwoFactor,
  });
  if (!accessValidation.ok) {
    res.status(accessValidation.failure.statusCode).json(accessValidation.failure.body);
    return;
  }

  const inputValidation = resolveChangePasswordInputValidation({
    currentPassword: req.body?.currentPassword,
    newPassword: req.body?.newPassword,
  });
  if (!inputValidation.ok) {
    res.status(inputValidation.failure.statusCode).json(inputValidation.failure.body);
    return;
  }
  const { userId } = accessValidation.actor;
  const { currentPassword, newPassword } = inputValidation.input;

  try {
    const db = await getDbInstance();
    const user = await getDb<User>(db, 'SELECT id, hashed_password FROM users WHERE id = ?', [
      userId,
    ]);

    const userValidation = resolvePasswordActionUserValidation({ user });
    if (!userValidation.ok) {
      console.error(`修改密码错误: 未找到 ID 为 ${userId} 的用户。`);
      res.status(userValidation.failure.statusCode).json(userValidation.failure.body);
      return;
    }

    const isMatch = await comparePassword(currentPassword, userValidation.user.hashed_password);
    const matchValidation = resolveCurrentPasswordMatchValidation({ isMatch });
    if (!matchValidation.ok) {
      console.debug(`修改密码尝试失败: 当前密码错误 - 用户 ID ${userId}`);
      res.status(matchValidation.failure.statusCode).json(matchValidation.failure.body);
      return;
    }

    const newHashedPassword = await hashPassword(newPassword);
    const now = Math.floor(Date.now() / 1000);

    const result = await runDb(
      db,
      'UPDATE users SET hashed_password = ?, updated_at = ? WHERE id = ?',
      [newHashedPassword, now, userId]
    );

    const changeValidation = resolveMutationChangesValidation({ changes: result.changes });
    if (!changeValidation.ok) {
      console.error(`修改密码错误: 更新影响行数为 0 - 用户 ID ${userId}`);
      throw changeValidation.error;
    }

    const clientIp = resolveRequestClientIp(req);
    const successAction = buildChangePasswordSuccessAction({ userId, clientIp });
    console[successAction.log.level](successAction.log.message);
    applyPasswordSecuritySideEffects(successAction.sideEffects);
    res.status(successAction.response.statusCode).json(successAction.response.body);
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

  try {
    const db = await getDbInstance();
    const user = await getDb<{ two_factor_secret: string | null }>(
      db,
      'SELECT two_factor_secret FROM users WHERE id = ?',
      [userId]
    );
    const existingSecret = user ? user.two_factor_secret : null;
    const setupValidation = resolveTwoFactorSetupRequestValidation({
      userId,
      username,
      requiresTwoFactor: req.session.requiresTwoFactor,
      existingSecret,
    });
    if (!setupValidation.ok) {
      res.status(setupValidation.failure.statusCode).json(setupValidation.failure.body);
      return;
    }
    const { userId: validatedUserId, username: validatedUsername } = setupValidation.actor;

    // 会话中已有临时密钥时直接复用，避免并发 setup 导致前后端密钥漂移。
    const reused = await respondWithExistingTwoFactorSetup(req, res, validatedUsername);
    if (reused) {
      return;
    }

    const secret = createTwoFactorSecret(validatedUsername);
    const saveResult = await saveTwoFactorSetupSessionSecret(req, secret);
    if (!saveResult.ok) {
      console.error(`[AuthController] 用户 ${validatedUserId} 保存临时 2FA 密钥到 session 失败`);
      res.status(saveResult.failure.statusCode).json(saveResult.failure.body);
      return;
    }

    await respondWithExistingTwoFactorSetup(req, res, validatedUsername);
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

  const { effectiveSecret, secretProvidedByBody, sessionSecretMismatched } =
    resolveTwoFactorEffectiveSecret({
      req,
      tempSecret,
      providedSecret,
    });
  const verifyValidation = resolveTwoFactorVerifyRequestValidation({
    userId,
    requiresTwoFactor: req.session.requiresTwoFactor,
    effectiveSecret,
    normalizedToken,
  });
  if (!verifyValidation.ok) {
    res.status(verifyValidation.failure.statusCode).json(verifyValidation.failure.body);
    return;
  }
  const { userId: validatedUserId } = verifyValidation.actor;

  try {
    if (sessionSecretMismatched) {
      // 兼容并发/重复 setup 导致会话临时密钥与页面展示密钥不一致的场景。
      console.warn(
        `[AuthController] 用户 ${validatedUserId} 的 2FA 临时密钥与前端提交密钥不一致，优先使用前端提交密钥进行校验。`
      );
    }

    if (secretProvidedByBody && sessionSecretMismatched) {
      console.debug(
        `[AuthController] 用户 ${validatedUserId} 的会话临时 2FA 密钥已同步为前端提交值。`
      );
    }

    const db = await getDbInstance();
    const verificationResult = verifyTwoFactorTokenWithSkew({
      secret: effectiveSecret,
      token: normalizedToken,
      verifyWindow: TOTP_VERIFY_WINDOW,
      skewDetectWindow: TOTP_SKEW_DETECT_WINDOW,
      skewWarnThreshold: TOTP_SKEW_WARN_THRESHOLD,
    });

    const verifyFailure = mapTwoFactorVerifyFailure(verificationResult);
    if (verifyFailure) {
      if (verifyFailure.kind === 'time_skew') {
        console.warn(
          `[AuthController] 用户 ${validatedUserId} 的 2FA 激活验证码存在明显时间偏差（delta=${verifyFailure.body.delta}），建议校准客户端时间。`
        );
      } else {
        console.debug(`用户 ${validatedUserId} 2FA 激活失败: 验证码错误。`);
      }

      res.status(verifyFailure.statusCode).json(verifyFailure.body);
      return;
    }

    if (verificationResult.status === 'verified') {
      const { delta } = verificationResult;
      if (Math.abs(delta) > TOTP_SKEW_WARN_THRESHOLD) {
        console.warn(
          `[AuthController] 用户 ${validatedUserId} 的 2FA 激活验证码存在明显时间偏差（delta=${delta}），建议校准客户端时间。`
        );
      }
      const enableMutation = buildEnableTwoFactorMutation({
        secret: effectiveSecret,
        userId: validatedUserId,
      });
      const result = await runDb(db, enableMutation.sql, enableMutation.params);
      const mutationValidation = resolveTwoFactorMutationChangesValidation({
        changes: result.changes,
      });
      if (!mutationValidation.ok) {
        console.error(`激活 2FA 错误: 更新影响行数为 0 - 用户 ID ${validatedUserId}`);
        throw mutationValidation.error;
      }

      console.info(`用户 ${validatedUserId} 已成功激活两步验证。`);
      recordTwoFactorEnabledEvent(
        { auditLogService, notificationService },
        { req, userId: validatedUserId }
      );

      delete req.session.tempTwoFactorSecret;

      res.status(200).json({ message: '两步验证已成功激活！' });
      return;
    }
  } catch (error: unknown) {
    console.error(`用户 ${validatedUserId} 验证并激活 2FA 时出错:`, error);
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
  const accessValidation = resolveDisable2FAAccessValidation({
    userId: req.session.userId,
    requiresTwoFactor: req.session.requiresTwoFactor,
  });
  if (!accessValidation.ok) {
    res.status(accessValidation.failure.statusCode).json(accessValidation.failure.body);
    return;
  }

  const inputValidation = resolveDisable2FAInputValidation({
    password: req.body?.password,
  });
  if (!inputValidation.ok) {
    res.status(inputValidation.failure.statusCode).json(inputValidation.failure.body);
    return;
  }
  const { userId } = accessValidation.actor;
  const { password } = inputValidation.input;

  try {
    const db = await getDbInstance();
    const user = await getDb<User>(db, 'SELECT id, hashed_password FROM users WHERE id = ?', [
      userId,
    ]);

    const userValidation = resolvePasswordActionUserValidation({ user });
    if (!userValidation.ok) {
      res.status(userValidation.failure.statusCode).json(userValidation.failure.body);
      return;
    }
    const isMatch = await comparePassword(password, userValidation.user.hashed_password);
    const matchValidation = resolveCurrentPasswordMatchValidation({ isMatch });
    if (!matchValidation.ok) {
      res.status(matchValidation.failure.statusCode).json(matchValidation.failure.body);
      return;
    }

    const disableMutation = buildDisableTwoFactorMutation({
      userId,
    });
    const result = await runDb(db, disableMutation.sql, disableMutation.params);

    const changeValidation = resolveTwoFactorMutationChangesValidation({ changes: result.changes });
    if (!changeValidation.ok) {
      console.error(`禁用 2FA 错误: 更新影响行数为 0 - 用户 ID ${userId}`);
      throw changeValidation.error;
    }

    const clientIp = resolveRequestClientIp(req);
    const successAction = buildDisableTwoFactorSuccessAction({ userId, clientIp });
    console[successAction.log.level](successAction.log.message);
    applyPasswordSecuritySideEffects(successAction.sideEffects);

    // 禁用时清理临时密钥，避免后续重新启用时读取到陈旧状态。
    delete req.session.tempTwoFactorSecret;

    res.status(successAction.response.statusCode).json(successAction.response.body);
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
    const authState = await resolveInitAuthState(db, req.session);

    // 3. 获取公共 CAPTCHA 配置
    const fullCaptchaConfig = await settingsService.getCaptchaConfig();
    const captchaConfig = toPublicCaptchaConfig(fullCaptchaConfig);

    // 4. 返回统一的初始化数据（保持 200 响应口径，仅抽离响应组装）
    res.status(200).json(
      buildInitDataBaseResponse({
        needsSetup: requiresSetup,
        authState,
        captchaConfig,
      })
    );

    console.debug(
      `[AuthController] 初始化数据已发送: needsSetup=${requiresSetup}, isAuthenticated=${authState.isAuthenticated}`
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
