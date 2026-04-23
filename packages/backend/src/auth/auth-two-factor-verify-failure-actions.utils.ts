import {
  mapTwoFactorVerifyFailure,
  type TwoFactorVerifyFailureMapping,
} from './auth-2fa-state-flow.utils';
import type { TwoFactorTokenVerificationResult } from './auth-two-factor-flow.utils';
import {
  buildTwoFactorVerifyInvalidDebugLogAction,
  buildTwoFactorVerifySkewWarnLogActionAlways,
} from './auth-two-factor-log-actions.utils';

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
      log: buildTwoFactorVerifySkewWarnLogActionAlways(userId, mappedFailure.body.delta),
    };
  }

  return {
    handled: true,
    response: {
      statusCode: mappedFailure.statusCode,
      body: mappedFailure.body,
    },
    log: buildTwoFactorVerifyInvalidDebugLogAction(userId),
  };
};
