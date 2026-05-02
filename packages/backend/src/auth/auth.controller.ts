/**
 * 认证控制器 - 主入口 / 协调模块
 *
 * 本文件仅负责从各领域子模块导入处理器并统一 re-export，
 * 保持 routes.ts 的导入路径不变（向后兼容）。
 *
 * 子模块划分：
 *   auth-login.handlers.ts     — 登录、登出、认证状态、初始设置、CAPTCHA、统一初始化
 *   auth-2fa-password.handlers.ts — 2FA 设置/验证/禁用、修改密码
 *   auth-passkey.handlers.ts   — Passkey 注册、认证、管理
 */
import type { ChallengeData } from './auth-passkey-flow.utils';
import type { PendingAuth } from './auth-login-2fa-flow.utils';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    username?: string;
    tempTwoFactorSecret?: string;
    requiresTwoFactor?: boolean;
    currentChallenge?: ChallengeData;
    passkeyUserHandle?: string;
    rememberMe?: boolean;
    pendingAuth?: PendingAuth;
  }
}

// --- 登录、登出、认证状态、初始设置、CAPTCHA、统一初始化 ---
export {
  login,
  getAuthStatus,
  verifyLogin2FA,
  needsSetup,
  setupAdmin,
  logout,
  getPublicCaptchaConfig,
  getInitData,
} from './auth-login.handlers';

// --- 2FA 设置/验证/禁用、修改密码 ---
export {
  setup2FA,
  verifyAndActivate2FA,
  disable2FA,
  changePassword,
} from './auth-2fa-password.handlers';

// --- Passkey 注册、认证、管理 ---
export {
  generatePasskeyRegistrationOptionsHandler,
  verifyPasskeyRegistrationHandler,
  generatePasskeyAuthenticationOptionsHandler,
  verifyPasskeyAuthenticationHandler,
  listUserPasskeysHandler,
  deleteUserPasskeyHandler,
  updateUserPasskeyNameHandler,
  checkHasPasskeys,
} from './auth-passkey.handlers';
