import { Router, type Request } from 'express';
import type { AuthService } from '../../../modules/auth/auth.service';
import type { CaptchaService } from '../../../modules/auth/captcha.service';
import type { IpBlacklistService } from '../../../modules/auth/ip-blacklist.service';
import type { TwoFactorService } from '../../../modules/auth/two-factor.service';
import type { PasskeyService } from '../../../modules/passkey/passkey.service';
import type { SettingsService } from '../../../modules/settings/settings.service';
import type { UserService } from '../../../modules/user/user.service';
import { createIpBlacklistCheck, requireAuthenticated } from './auth.middleware';
import { destroySession, errorMessage, regenerateSession, requestIp } from '../shared/http-utils';
import { route } from '../shared/route-handler';
import { toLegacyPasskeySummaryDto } from '../legacy-api/passkey-http.mapper';

const REMEMBER_ME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthRouterDependencies {
  auth: AuthService;
  twoFactor: TwoFactorService;
  captcha: CaptchaService;
  ipBlacklist: IpBlacklistService;
  passkeys: PasskeyService;
  settings: SettingsService;
  users: UserService;
  sessionCookieName: string;
}

const configureSessionLifetime = (request: Request, rememberMe: boolean): void => {
  request.session.cookie.maxAge = rememberMe ? REMEMBER_ME_MAX_AGE_MS : undefined;
};

const firstHeaderValue = (value: string | string[] | undefined): string | undefined => {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw
    ?.split(',')
    .map((item) => item.trim())
    .find(Boolean);
};

const requestOrigin = (request: Request): string | undefined => {
  const origin = firstHeaderValue(request.headers.origin);
  if (origin) return origin;
  const protocol = firstHeaderValue(request.headers['x-forwarded-proto']) || request.protocol;
  const host = firstHeaderValue(request.headers['x-forwarded-host']) || firstHeaderValue(request.headers.host);
  return protocol && host ? `${protocol}://${host}` : undefined;
};

export const createAuthRouter = (dependencies: AuthRouterDependencies): Router => {
  const router = Router();
  const blacklistCheck = createIpBlacklistCheck(dependencies.ipBlacklist);

  router.get(
    '/captcha/config',
    route(async (_request, response) => {
      try {
        const config = await dependencies.settings.getCaptchaConfig();
        response.json({
          enabled: config.enabled,
          provider: config.provider,
          hcaptchaSiteKey: config.hcaptchaSiteKey,
          recaptchaSiteKey: config.recaptchaSiteKey,
        });
      } catch {
        response.json({ enabled: false, provider: 'none', hcaptchaSiteKey: '', recaptchaSiteKey: '' });
      }
    }),
  );

  router.get(
    '/needs-setup',
    route(async (_request, response) => {
      response.json({ needsSetup: await dependencies.auth.needsSetup() });
    }),
  );

  router.post(
    '/setup',
    route(async (request, response) => {
      const { username, password, confirmPassword } = request.body ?? {};
      if (!username || !password || !confirmPassword) {
        response.status(400).json({ message: '用户名、密码和确认密码不能为空。' });
        return;
      }
      if (password !== confirmPassword) {
        response.status(400).json({ message: '两次输入的密码不匹配。' });
        return;
      }
      try {
        await dependencies.auth.setupAdmin(String(username), String(password), { ip: requestIp(request) });
        response.status(201).json({ message: '初始管理员账号创建成功！' });
      } catch (error) {
        const message = errorMessage(error);
        response
          .status(
            message.includes('设置已完成')
              ? 403
              : message.includes('密码长度') || message.includes('用户名')
                ? 400
                : 500,
          )
          .json({ message });
      }
    }),
  );

  router.post(
    '/login',
    blacklistCheck,
    route(async (request, response) => {
      const { username, password, rememberMe, captchaToken } = request.body ?? {};
      if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
        response.status(400).json({ message: '用户名和密码不能为空。' });
        return;
      }
      const ip = requestIp(request);
      const captchaConfig = await dependencies.settings.getCaptchaConfig();
      if (captchaConfig.enabled) {
        if (typeof captchaToken !== 'string' || !captchaToken) {
          response.status(400).json({ message: '需要提供 CAPTCHA 令牌。' });
          return;
        }
        let validCaptcha: boolean;
        try {
          validCaptcha = await dependencies.captcha.verifyToken(captchaToken);
        } catch {
          response.status(500).json({ message: 'CAPTCHA 验证服务出错，请稍后重试或检查配置。' });
          return;
        }
        if (!validCaptcha) {
          await Promise.all([
            dependencies.ipBlacklist.recordFailedAttempt(ip),
            dependencies.auth.recordLoginFailure(username, 'Invalid CAPTCHA token', ip),
          ]);
          response.status(401).json({ message: 'CAPTCHA 验证失败。' });
          return;
        }
      }

      const result = await dependencies.auth.authenticatePassword(username, password, { ip });
      if (result.status === 'invalid') {
        await dependencies.ipBlacklist.recordFailedAttempt(ip);
        response.status(401).json({ message: '无效的凭据。' });
        return;
      }
      if (result.status === 'requiresTwoFactor') {
        await regenerateSession(request);
        request.session.userId = result.userId;
        request.session.requiresTwoFactor = true;
        request.session.rememberMe = Boolean(rememberMe);
        response.json({ message: '需要进行两步验证。', requiresTwoFactor: true });
        return;
      }

      await dependencies.ipBlacklist.resetAttempts(ip);
      await regenerateSession(request);
      request.session.userId = result.user.id;
      request.session.username = result.user.username;
      request.session.requiresTwoFactor = false;
      configureSessionLifetime(request, Boolean(rememberMe));
      response.json({ message: '登录成功。', user: result.user });
    }),
  );

  router.post(
    '/login/2fa',
    blacklistCheck,
    route(async (request, response) => {
      const userId = request.session.userId;
      const token = request.body?.token;
      if (!userId || request.session.requiresTwoFactor !== true) {
        response.status(400).json({ message: '无效的请求或会话状态。' });
        return;
      }
      if (typeof token !== 'string' || !token) {
        response.status(400).json({ message: '验证码不能为空。' });
        return;
      }
      const ip = requestIp(request);
      const result = await dependencies.twoFactor.verifyLogin(userId, token, { ip });
      if (!result.valid) {
        await dependencies.ipBlacklist.recordFailedAttempt(ip);
        response.status(401).json({ message: '验证码无效。' });
        return;
      }
      const rememberMe = Boolean(request.session.rememberMe);
      await dependencies.ipBlacklist.resetAttempts(ip);
      await regenerateSession(request);
      request.session.userId = result.user.id;
      request.session.username = result.user.username;
      request.session.requiresTwoFactor = false;
      configureSessionLifetime(request, rememberMe);
      response.json({ message: '登录成功。', user: result.user });
    }),
  );

  router.get(
    '/status',
    requireAuthenticated,
    route(async (request, response) => {
      const user = await dependencies.users.get(request.session.userId!);
      if (!user) {
        response.status(401).json({ isAuthenticated: false });
        return;
      }
      response.json({
        isAuthenticated: true,
        user: { id: user.id, username: request.session.username!, isTwoFactorEnabled: user.hasTwoFactor },
      });
    }),
  );

  router.put(
    '/password',
    requireAuthenticated,
    route(async (request, response) => {
      const { currentPassword, newPassword } = request.body ?? {};
      if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
        response.status(400).json({ message: '当前密码和新密码不能为空。' });
        return;
      }
      try {
        await dependencies.auth.changePassword(request.session.userId!, currentPassword, newPassword, {
          ip: requestIp(request),
        });
        response.json({ message: '密码已成功修改。' });
      } catch (error) {
        const message = errorMessage(error);
        response.status(message.includes('用户不存在') ? 404 : message.includes('密码') ? 400 : 500).json({ message });
      }
    }),
  );

  router.post(
    '/2fa/setup',
    requireAuthenticated,
    route(async (request, response) => {
      try {
        const setup = await dependencies.twoFactor.beginSetup(request.session.userId!, request.session.username!);
        request.session.tempTwoFactorSecret = setup.secret;
        response.json(setup);
      } catch (error) {
        response.status(errorMessage(error).includes('已启用') ? 400 : 500).json({ message: errorMessage(error) });
      }
    }),
  );

  router.post(
    '/2fa/verify',
    requireAuthenticated,
    route(async (request, response) => {
      const token = request.body?.token;
      const secret = request.session.tempTwoFactorSecret;
      if (!secret) {
        response.status(400).json({ message: '未找到临时密钥，请重新开始设置流程。' });
        return;
      }
      if (typeof token !== 'string' || !token) {
        response.status(400).json({ message: '验证码不能为空。' });
        return;
      }
      const verified = await dependencies.twoFactor.activate(request.session.userId!, secret, token, {
        ip: requestIp(request),
      });
      if (!verified) {
        response.status(400).json({ message: '验证码无效，请重试。' });
        return;
      }
      delete request.session.tempTwoFactorSecret;
      response.json({ message: '两步验证已成功启用。' });
    }),
  );

  router.delete(
    '/2fa',
    requireAuthenticated,
    route(async (request, response) => {
      const password = request.body?.password;
      if (typeof password !== 'string' || !password) {
        response.status(400).json({ message: '当前密码不能为空。' });
        return;
      }
      try {
        await dependencies.twoFactor.disable(request.session.userId!, password, { ip: requestIp(request) });
        response.json({ message: '两步验证已成功禁用。' });
      } catch (error) {
        const message = errorMessage(error);
        response
          .status(message.includes('密码不正确') ? 400 : message.includes('用户不存在') ? 404 : 500)
          .json({ message });
      }
    }),
  );

  router.post(
    '/passkey/registration-options',
    requireAuthenticated,
    route(async (request, response) => {
      const origin = requestOrigin(request);
      const options = await dependencies.passkeys.beginRegistration({
        userId: request.session.userId!,
        username: request.session.username!,
        origin,
      });
      request.session.currentChallenge = options.challenge;
      request.session.passkeyOrigin = origin;
      request.session.passkeyRegistrationUserId = request.session.userId;
      response.json(options);
    }),
  );

  router.post(
    '/passkey/register',
    requireAuthenticated,
    route(async (request, response) => {
      const registrationResponse = request.body?.registrationResponse;
      if (!registrationResponse) {
        response.status(400).json({ message: '注册响应不能为空。' });
        return;
      }
      if (!request.session.currentChallenge || request.session.passkeyRegistrationUserId !== request.session.userId) {
        response.status(400).json({ message: '会话中未找到有效的注册质询信息，请重试注册流程。' });
        return;
      }
      const verified = await dependencies.passkeys.finishRegistration({
        userId: request.session.userId!,
        username: request.session.username!,
        response: registrationResponse,
        expectedChallenge: request.session.currentChallenge,
        origin: request.session.passkeyOrigin || requestOrigin(request),
      });
      delete request.session.currentChallenge;
      delete request.session.passkeyOrigin;
      delete request.session.passkeyRegistrationUserId;
      response
        .status(verified ? 201 : 400)
        .json({ verified, message: verified ? 'Passkey 注册成功。' : 'Passkey 注册验证失败。' });
    }),
  );

  router.post(
    '/passkey/authentication-options',
    route(async (request, response) => {
      const origin = requestOrigin(request);
      const options = await dependencies.passkeys.beginAuthentication({
        username: typeof request.body?.username === 'string' ? request.body.username : undefined,
        origin,
      });
      request.session.currentChallenge = options.challenge;
      request.session.passkeyOrigin = origin;
      response.json(options);
    }),
  );

  router.post(
    '/passkey/authenticate',
    blacklistCheck,
    route(async (request, response) => {
      const assertionResponse = request.body?.assertionResponse;
      const challenge = request.session.currentChallenge;
      if (!assertionResponse) {
        response.status(400).json({ message: '认证响应 (assertionResponse) 不能为空。' });
        return;
      }
      if (!challenge) {
        response.status(400).json({ message: '会话中未找到质询信息，请重试认证流程。' });
        return;
      }
      const ip = requestIp(request);
      const result = await dependencies.passkeys.finishAuthentication({
        response: assertionResponse,
        expectedChallenge: challenge,
        origin: request.session.passkeyOrigin || requestOrigin(request),
        ip,
      });
      if (!result.verified) {
        await dependencies.ipBlacklist.recordFailedAttempt(ip);
        response.status(401).json({ verified: false, message: 'Passkey 认证失败。' });
        return;
      }
      await dependencies.ipBlacklist.resetAttempts(ip);
      await regenerateSession(request);
      request.session.userId = result.user.id;
      request.session.username = result.user.username;
      request.session.requiresTwoFactor = false;
      configureSessionLifetime(request, Boolean(request.body?.rememberMe));
      response.json({ verified: true, message: 'Passkey 认证成功。', user: result.user });
    }),
  );

  router.get(
    '/passkey/has-configured',
    route(async (request, response) => {
      try {
        const username = typeof request.query.username === 'string' ? request.query.username : undefined;
        response.json({ hasPasskeys: await dependencies.passkeys.hasConfigured(username) });
      } catch {
        response.json({ hasPasskeys: false, error: '检查 Passkey 配置时出错。' });
      }
    }),
  );

  router.get(
    '/user/passkeys',
    requireAuthenticated,
    route(async (request, response) => {
      response.json((await dependencies.passkeys.list(request.session.userId!)).map(toLegacyPasskeySummaryDto));
    }),
  );

  router.delete(
    '/user/passkeys/:credentialID',
    requireAuthenticated,
    route(async (request, response) => {
      try {
        const deleted = await dependencies.passkeys.remove(
          request.session.userId!,
          String(request.params.credentialID),
          request.session.username,
        );
        response
          .status(deleted ? 200 : 404)
          .json({ message: deleted ? 'Passkey 删除成功。' : 'Passkey 未找到或无法删除。' });
      } catch (error) {
        const message = errorMessage(error);
        response
          .status(message.includes('Unauthorized') ? 403 : message.includes('not found') ? 404 : 500)
          .json({ message });
      }
    }),
  );

  router.put(
    '/user/passkeys/:credentialID/name',
    requireAuthenticated,
    route(async (request, response) => {
      try {
        await dependencies.passkeys.rename(
          request.session.userId!,
          String(request.params.credentialID),
          request.body?.name,
          request.session.username,
        );
        response.json({ message: 'Passkey 名称更新成功。' });
      } catch (error) {
        const message = errorMessage(error);
        response
          .status(
            message.includes('Unauthorized')
              ? 403
              : message.includes('not found')
                ? 404
                : message.includes('名称')
                  ? 400
                  : 500,
          )
          .json({ message });
      }
    }),
  );

  router.post(
    '/logout',
    route(async (request, response) => {
      const userId = request.session.userId;
      const username = request.session.username;
      const ip = requestIp(request);
      await destroySession(request);
      response.clearCookie(dependencies.sessionCookieName, { httpOnly: true, sameSite: 'lax', secure: request.secure });
      if (userId && username) await dependencies.auth.recordLogout(userId, username, ip);
      response.json({ message: '已成功登出。' });
    }),
  );

  return router;
};
