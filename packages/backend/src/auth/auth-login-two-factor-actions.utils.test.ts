import { describe, expect, it } from 'vitest';
import {
  buildLoginTwoFactorDiagnosticsLogActions,
  buildLoginTwoFactorFallbackFailureResponseAction,
  buildLoginTwoFactorFailureAttemptAction,
  buildLoginTwoFactorFailureAttemptPayload,
  buildLoginTwoFactorMissingSecretFailureAction,
  buildLoginTwoFactorPendingValidationFailedDebugLogAction,
  buildLoginTwoFactorSessionCompletionAction,
  buildLoginTwoFactorSuccessAttemptAction,
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
      failureReason: 'Invalid 2FA token',
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

  it('应构建登录 2FA 失败尝试参数与调试日志动作', () => {
    expect(
      buildLoginTwoFactorFailureAttemptPayload({
        userId: 7,
        username: 'alice',
        clientIp: '127.0.0.1',
      })
    ).toEqual({
      userId: 7,
      username: 'alice',
      reason: 'Invalid 2FA token',
      clientIp: '127.0.0.1',
    });

    expect(
      buildLoginTwoFactorDiagnosticsLogActions({
        hasPendingAuth: true,
        hasTempToken: false,
        forwardedProto: 'https',
      })
    ).toEqual([
      {
        level: 'debug',
        message: '[AuthController] verifyLogin2FA - Has pendingAuth: true',
      },
      {
        level: 'debug',
        message: '[AuthController] verifyLogin2FA - Has tempToken: false',
      },
      {
        level: 'debug',
        message: '[AuthController] verifyLogin2FA - X-Forwarded-Proto: https',
      },
    ]);

    expect(
      buildLoginTwoFactorPendingValidationFailedDebugLogAction({
        hasPendingAuth: false,
        hasTempToken: true,
      })
    ).toEqual({
      level: 'debug',
      message: '[AuthController] verifyLogin2FA - FAILED: pendingAuth=false, tempToken=true',
    });
  });

  it('应构建 success/failure attempt 动作与通用响应动作', () => {
    expect(
      buildLoginTwoFactorSuccessAttemptAction({
        userId: 1,
        username: 'alice',
        clientIp: '10.0.0.1',
      })
    ).toEqual({
      kind: 'success',
      payload: {
        userId: 1,
        username: 'alice',
        clientIp: '10.0.0.1',
        twoFactor: true,
      },
    });

    expect(
      buildLoginTwoFactorFailureAttemptAction({
        userId: 1,
        username: 'alice',
        clientIp: '10.0.0.2',
      })
    ).toEqual({
      kind: 'failure',
      payload: {
        userId: 1,
        username: 'alice',
        reason: 'Invalid 2FA token',
        clientIp: '10.0.0.2',
      },
    });

    expect(
      buildLoginTwoFactorSessionCompletionAction({
        user: { id: 1, username: 'alice' },
        rememberMe: true,
      })
    ).toEqual({
      user: { id: 1, username: 'alice' },
      rememberMe: true,
      saveErrorMessage: '登录完成失败，请重试。',
    });

    expect(
      buildLoginTwoFactorMissingSecretFailureAction({
        pendingUserId: 9,
      })
    ).toEqual({
      response: {
        statusCode: 400,
        body: { message: '无法验证，请重新登录。' },
      },
      log: {
        level: 'error',
        message: '2FA 验证错误: 未找到用户 9 或未设置密钥。',
      },
    });

    expect(buildLoginTwoFactorFallbackFailureResponseAction()).toEqual({
      statusCode: 401,
      body: { message: '验证码无效。' },
    });
  });
});
