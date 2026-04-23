import { describe, expect, it } from 'vitest';
import { resolveTwoFactorVerifyFailureAction } from './auth-two-factor-verify-failure-actions.utils';

describe('auth-two-factor-verify-failure-actions.utils', () => {
  it('verified 结果应返回 handled=false', () => {
    const action = resolveTwoFactorVerifyFailureAction({
      userId: 9,
      verificationResult: {
        status: 'verified',
        delta: 0,
      },
    });

    expect(action).toEqual({ handled: false });
  });

  it('invalid 结果应返回 debug 日志与 400 响应', () => {
    const action = resolveTwoFactorVerifyFailureAction({
      userId: 12,
      verificationResult: {
        status: 'invalid',
      },
    });

    expect(action).toEqual({
      handled: true,
      response: {
        statusCode: 400,
        body: { message: '验证码无效。' },
      },
      log: {
        level: 'debug',
        message: '用户 12 2FA 激活失败: 验证码错误。',
      },
    });
  });

  it('time_skew 结果应返回 warn 日志与偏差响应体', () => {
    const action = resolveTwoFactorVerifyFailureAction({
      userId: 15,
      verificationResult: {
        status: 'time_skew',
        delta: 3,
        skewSeconds: 90,
      },
    });

    expect(action).toEqual({
      handled: true,
      response: {
        statusCode: 400,
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
          '[AuthController] 用户 15 的 2FA 激活验证码存在明显时间偏差（delta=3），建议校准客户端时间。',
      },
    });
  });
});
