import {
  mapTwoFactorVerifyFailure,
  type TwoFactorVerifyFailureMapping,
} from './auth-2fa-state-flow.utils';
import type { TwoFactorTokenVerificationResult } from './auth-two-factor-flow.utils';

type TwoFactorVerifyFailureLogAction =
  | {
      level: 'warn';
      message: string;
    }
  | {
      level: 'debug';
      message: string;
    };

type TwoFactorVerifyFailureResponse = {
  statusCode: TwoFactorVerifyFailureMapping['statusCode'];
  body: TwoFactorVerifyFailureMapping['body'];
};

export type TwoFactorVerifyFailureAction =
  | {
      handled: false;
    }
  | {
      handled: true;
      response: TwoFactorVerifyFailureResponse;
      log: TwoFactorVerifyFailureLogAction;
    };

export const resolveTwoFactorVerifyFailureAction = (payload: {
  userId: number;
  verificationResult: TwoFactorTokenVerificationResult;
}): TwoFactorVerifyFailureAction => {
  const { userId, verificationResult } = payload;
  const mappedFailure = mapTwoFactorVerifyFailure(verificationResult);
  if (!mappedFailure) {
    return { handled: false };
  }

  if (mappedFailure.kind === 'time_skew') {
    return {
      handled: true,
      response: {
        statusCode: mappedFailure.statusCode,
        body: mappedFailure.body,
      },
      log: {
        level: 'warn',
        message: `[AuthController] 用户 ${userId} 的 2FA 激活验证码存在明显时间偏差（delta=${mappedFailure.body.delta}），建议校准客户端时间。`,
      },
    };
  }

  return {
    handled: true,
    response: {
      statusCode: mappedFailure.statusCode,
      body: mappedFailure.body,
    },
    log: {
      level: 'debug',
      message: `用户 ${userId} 2FA 激活失败: 验证码错误。`,
    },
  };
};
