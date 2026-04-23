import { describe, expect, it } from 'vitest';
import {
  buildLoginTwoFactorSuccessLogAction,
  resolveLoginTwoFactorFailureAction,
} from './auth-login-two-factor-actions.utils';

describe('auth-login-two-factor-actions.utils', () => {
  it('time_skew 应返回 401 与 TIME_SKEW_DETECTED 响应', () => {
    const action = resolveLoginTwoFactorFailureAction({
      username: 'alice',
      verificationResult: {
        status: 'time_skew',
        delta: 3,
        skewSeconds: 90,
      },
    });

    expect(action).toEqual({
      handled: true,
      response: {
        statusCode: 401,
        body: {
          message: '验证码无效。检测到客户端时间与服务器存在约 90 秒偏差，请校准设备时间后重试。',
          code: 'TIME_SKEW_DETECTED',
          skewSeconds: 90,
          delta: 3,
        },
      },
      log: {
        level: 'warn',
        message:
          '[AuthController] 用户 alice 的 2FA 登录验证码存在明显时间偏差（delta=3），建议校准客户端时间。',
      },
    });
  });

  it('invalid 应返回 401 与验证码无效响应', () => {
    const action = resolveLoginTwoFactorFailureAction({
      username: 'alice',
      verificationResult: { status: 'invalid' },
    });

    expect(action).toEqual({
      handled: true,
      response: {
        statusCode: 401,
        body: { message: '验证码无效。' },
      },
      log: {
        level: 'debug',
        message: '用户 alice 2FA 验证失败: 验证码错误。',
      },
    });
  });

  it('verified 应返回 handled=false，成功日志动作保持稳定', () => {
    const failureAction = resolveLoginTwoFactorFailureAction({
      username: 'alice',
      verificationResult: { status: 'verified', delta: 0 },
    });
    expect(failureAction).toEqual({ handled: false });

    expect(buildLoginTwoFactorSuccessLogAction('alice')).toEqual({
      level: 'info',
      message: '用户 alice 2FA 验证成功。',
    });
  });
});
