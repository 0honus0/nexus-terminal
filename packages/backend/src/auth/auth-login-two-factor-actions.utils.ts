import type { TwoFactorTokenVerificationResult } from './auth-two-factor-flow.utils';
import {
  buildLoginTwoFactorInvalidDebugLogAction,
  buildLoginTwoFactorSkewWarnLogActionAlways,
  buildLoginTwoFactorSuccessInfoLogAction,
} from './auth-two-factor-log-actions.utils';

export type LoginTwoFactorFailureReason = 'Invalid 2FA token';

export interface LoginTwoFactorFailureAttemptPayload {
  userId: number;
  username: string;
  reason: LoginTwoFactorFailureReason;
  clientIp: string;
}

export type LoginTwoFactorFailureAction =
  | {
      handled: false;
    }
  | {
      handled: true;
      failureReason?: LoginTwoFactorFailureReason;
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
    failureReason: 'Invalid 2FA token',
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

export const buildLoginTwoFactorFailureAttemptPayload = (payload: {
  userId: number;
  username: string;
  clientIp: string;
  reason?: LoginTwoFactorFailureReason;
}): LoginTwoFactorFailureAttemptPayload => {
  const { userId, username, clientIp, reason = 'Invalid 2FA token' } = payload;

  return {
    userId,
    username,
    reason,
    clientIp,
  };
};

export interface LoginTwoFactorDebugLogAction {
  level: 'debug';
  message: string;
}

export const buildLoginTwoFactorDiagnosticsLogActions = (payload: {
  hasPendingAuth: boolean;
  hasTempToken: boolean;
  forwardedProto?: string;
}): LoginTwoFactorDebugLogAction[] => {
  const { hasPendingAuth, hasTempToken, forwardedProto } = payload;

  return [
    {
      level: 'debug',
      message: `[AuthController] verifyLogin2FA - Has pendingAuth: ${hasPendingAuth}`,
    },
    {
      level: 'debug',
      message: `[AuthController] verifyLogin2FA - Has tempToken: ${hasTempToken}`,
    },
    {
      level: 'debug',
      message: `[AuthController] verifyLogin2FA - X-Forwarded-Proto: ${forwardedProto ?? ''}`,
    },
  ];
};

export const buildLoginTwoFactorPendingValidationFailedDebugLogAction = (payload: {
  hasPendingAuth: boolean;
  hasTempToken: boolean;
}): LoginTwoFactorDebugLogAction => ({
  level: 'debug',
  message: `[AuthController] verifyLogin2FA - FAILED: pendingAuth=${payload.hasPendingAuth}, tempToken=${payload.hasTempToken}`,
});
