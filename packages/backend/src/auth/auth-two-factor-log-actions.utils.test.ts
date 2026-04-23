import { describe, expect, it } from 'vitest';
import {
  buildLoginTwoFactorInvalidDebugLogAction,
  buildLoginTwoFactorSkewWarnLogAction,
  buildLoginTwoFactorSkewWarnLogActionAlways,
  buildLoginTwoFactorSuccessInfoLogAction,
  buildTwoFactorSetupGeneratedLogAction,
  buildTwoFactorSetupReuseLogAction,
  buildTwoFactorSetupSaveFailedLogAction,
  buildTwoFactorVerifyInvalidDebugLogAction,
  buildTwoFactorVerifySessionMismatchWarnLogAction,
  buildTwoFactorVerifySessionSyncedDebugLogAction,
  buildTwoFactorVerifySkewWarnLogAction,
  buildTwoFactorVerifySkewWarnLogActionAlways,
} from './auth-two-factor-log-actions.utils';

describe('auth-two-factor-log-actions.utils', () => {
  it('setup 日志动作应返回稳定模板', () => {
    expect(buildTwoFactorSetupReuseLogAction(1)).toEqual({
      level: 'debug',
      message: '[AuthController] 用户 1 复用已存在的临时 2FA 密钥，直接返回 setup payload。',
    });
    expect(buildTwoFactorSetupSaveFailedLogAction(2)).toEqual({
      level: 'error',
      message: '[AuthController] 用户 2 保存临时 2FA 密钥到 session 失败',
    });
    expect(buildTwoFactorSetupGeneratedLogAction(3)).toEqual({
      level: 'info',
      message: '[AuthController] 用户 3 生成新的临时 2FA 密钥并返回 setup payload。',
    });
  });

  it('verify 会话密钥日志动作应返回稳定模板', () => {
    expect(buildTwoFactorVerifySessionMismatchWarnLogAction(8)).toEqual({
      level: 'warn',
      message:
        '[AuthController] 用户 8 的 2FA 临时密钥与前端提交密钥不一致，优先使用前端提交密钥进行校验。',
    });
    expect(buildTwoFactorVerifySessionSyncedDebugLogAction(8)).toEqual({
      level: 'debug',
      message: '[AuthController] 用户 8 的会话临时 2FA 密钥已同步为前端提交值。',
    });
  });

  it('skew 日志动作应按阈值返回 warn/null', () => {
    expect(
      buildTwoFactorVerifySkewWarnLogAction({
        userId: 10,
        delta: 3,
        skewWarnThreshold: 2,
      })
    ).toEqual({
      level: 'warn',
      message:
        '[AuthController] 用户 10 的 2FA 激活验证码存在明显时间偏差（delta=3），建议校准客户端时间。',
    });
    expect(
      buildTwoFactorVerifySkewWarnLogAction({
        userId: 10,
        delta: 2,
        skewWarnThreshold: 2,
      })
    ).toBeNull();
  });

  it('always/invalid 日志动作应返回稳定模板', () => {
    expect(buildTwoFactorVerifySkewWarnLogActionAlways(11, -4)).toEqual({
      level: 'warn',
      message:
        '[AuthController] 用户 11 的 2FA 激活验证码存在明显时间偏差（delta=-4），建议校准客户端时间。',
    });
    expect(buildTwoFactorVerifyInvalidDebugLogAction(12)).toEqual({
      level: 'debug',
      message: '用户 12 2FA 激活失败: 验证码错误。',
    });
  });

  it('login skew/success/invalid 日志动作应返回稳定模板', () => {
    expect(
      buildLoginTwoFactorSkewWarnLogAction({
        username: 'alice',
        delta: 3,
        skewWarnThreshold: 2,
      })
    ).toEqual({
      level: 'warn',
      message:
        '[AuthController] 用户 alice 的 2FA 登录验证码存在明显时间偏差（delta=3），建议校准客户端时间。',
    });
    expect(
      buildLoginTwoFactorSkewWarnLogAction({
        username: 'alice',
        delta: 2,
        skewWarnThreshold: 2,
      })
    ).toBeNull();
    expect(buildLoginTwoFactorSkewWarnLogActionAlways('alice', -4)).toEqual({
      level: 'warn',
      message:
        '[AuthController] 用户 alice 的 2FA 登录验证码存在明显时间偏差（delta=-4），建议校准客户端时间。',
    });
    expect(buildLoginTwoFactorSuccessInfoLogAction('alice')).toEqual({
      level: 'info',
      message: '用户 alice 2FA 验证成功。',
    });
    expect(buildLoginTwoFactorInvalidDebugLogAction('alice')).toEqual({
      level: 'debug',
      message: '用户 alice 2FA 验证失败: 验证码错误。',
    });
  });
});
