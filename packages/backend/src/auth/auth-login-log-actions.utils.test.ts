import { describe, expect, it } from 'vitest';
import {
  buildLoginCaptchaInvalidDebugLogAction,
  buildLoginCaptchaSkippedDebugLogAction,
  buildLoginCaptchaVerificationErrorLogAction,
  buildLoginCaptchaVerifiedDebugLogAction,
  buildLoginInternalErrorLogAction,
  buildLoginInvalidPasswordDebugLogAction,
  buildLoginSuccessWithoutTwoFactorInfoLogAction,
  buildLoginTwoFactorRequiredDebugLogAction,
  buildLoginUserNotFoundDebugLogAction,
} from './auth-login-log-actions.utils';

describe('auth-login-log-actions.utils', () => {
  it('应返回稳定的 CAPTCHA 日志动作模板', () => {
    expect(buildLoginCaptchaInvalidDebugLogAction('alice')).toEqual({
      level: 'debug',
      message: '[AuthController] 登录尝试失败: CAPTCHA 验证失败 - alice',
    });
    expect(buildLoginCaptchaVerifiedDebugLogAction('alice')).toEqual({
      level: 'debug',
      message: '[AuthController] CAPTCHA 验证成功 - alice',
    });
    expect(buildLoginCaptchaVerificationErrorLogAction('alice')).toEqual({
      level: 'error',
      message: '[AuthController] CAPTCHA 验证过程中出错 (alice):',
    });
    expect(buildLoginCaptchaSkippedDebugLogAction('alice')).toEqual({
      level: 'debug',
      message: '[AuthController] CAPTCHA 未启用，跳过验证 - alice',
    });
  });

  it('应返回稳定的登录结果日志动作模板', () => {
    expect(buildLoginUserNotFoundDebugLogAction('alice')).toEqual({
      level: 'debug',
      message: '登录尝试失败: 用户未找到 - alice',
    });
    expect(buildLoginInvalidPasswordDebugLogAction('alice')).toEqual({
      level: 'debug',
      message: '登录尝试失败: 密码错误 - alice',
    });
    expect(buildLoginTwoFactorRequiredDebugLogAction('alice')).toEqual({
      level: 'debug',
      message: '用户 alice 已启用 2FA，需要进行二次验证。',
    });
    expect(buildLoginSuccessWithoutTwoFactorInfoLogAction('alice')).toEqual({
      level: 'info',
      message: '登录成功 (无 2FA): alice',
    });
    expect(buildLoginInternalErrorLogAction()).toEqual({
      level: 'error',
      message: '登录时出错:',
    });
  });
});
