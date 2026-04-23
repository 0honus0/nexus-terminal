import type { TwoFactorTokenVerificationResult } from './auth-two-factor-flow.utils';
import {
  buildLoginTwoFactorInvalidDebugLogAction,
  buildLoginTwoFactorSkewWarnLogActionAlways,
  buildLoginTwoFactorSuccessInfoLogAction,
} from './auth-two-factor-log-actions.utils';

export type LoginTwoFactorFailureAction =
  | {
      handled: false;
    }
  | {
      handled: true;
      response: {
        statusCode: 401;
        body:
          | {
              message: string;
              code: 'TIME_SKEW_DETECTED';
              skewSeconds: number;
              delta: number;
            }
          | {
              message: '验证码无效。';
            };
      };
      log: {
        level: 'warn' | 'debug';
        message: string;
      };
    };

export const resolveLoginTwoFactorFailureAction = (payload: {
  username: string;
  verificationResult: TwoFactorTokenVerificationResult;
}): LoginTwoFactorFailureAction => {
  const { username, verificationResult } = payload;

  if (verificationResult.status === 'verified') {
    return { handled: false };
  }

  if (verificationResult.status === 'time_skew') {
    return {
      handled: true,
      response: {
        statusCode: 401,
        body: {
          message: `验证码无效。检测到客户端时间与服务器存在约 ${verificationResult.skewSeconds} 秒偏差，请校准设备时间后重试。`,
          code: 'TIME_SKEW_DETECTED',
          skewSeconds: verificationResult.skewSeconds,
          delta: verificationResult.delta,
        },
      },
      log: buildLoginTwoFactorSkewWarnLogActionAlways(username, verificationResult.delta),
    };
  }

  return {
    handled: true,
    response: {
      statusCode: 401,
      body: { message: '验证码无效。' },
    },
    log: buildLoginTwoFactorInvalidDebugLogAction(username),
  };
};

export const buildLoginTwoFactorSuccessLogAction = (
  username: string
): {
  level: 'info';
  message: string;
} => buildLoginTwoFactorSuccessInfoLogAction(username);
