import { Request } from 'express';
import {
  buildTwoFactorSetupPayload,
  type SetupPayload,
  createTwoFactorSecret,
} from './auth-two-factor-flow.utils';
import { saveTwoFactorSetupSessionSecret } from './auth-2fa-state-flow.utils';
import {
  buildTwoFactorSetupGeneratedLogAction,
  buildTwoFactorSetupReuseLogAction,
  buildTwoFactorSetupSaveFailedLogAction,
} from './auth-two-factor-log-actions.utils';
import { readTwoFactorSessionSecret } from './auth-two-factor-session-actions.utils';

type SaveTwoFactorSessionResult = Awaited<ReturnType<typeof saveTwoFactorSetupSessionSecret>>;
type SaveTwoFactorSessionFailure = Extract<SaveTwoFactorSessionResult, { ok: false }>['failure'];

export type TwoFactorSetupActionResult =
  | {
      ok: true;
      reused: boolean;
      response: {
        statusCode: 200;
        body: SetupPayload;
      };
      log: {
        level: 'debug' | 'info';
        message: string;
      };
    }
  | {
      ok: false;
      failure: SaveTwoFactorSessionFailure;
      log: {
        level: 'error';
        message: string;
      };
    };

export const executeTwoFactorSetupAction = async (payload: {
  req: Request;
  userId: number;
  username: string;
}): Promise<TwoFactorSetupActionResult> => {
  const { req, userId, username } = payload;
  const sessionTempSecret = readTwoFactorSessionSecret(req);

  if (sessionTempSecret) {
    const responseBody = await buildTwoFactorSetupPayload(username, sessionTempSecret);
    return {
      ok: true,
      reused: true,
      response: {
        statusCode: 200,
        body: responseBody,
      },
      log: {
        ...buildTwoFactorSetupReuseLogAction(userId),
      },
    };
  }

  const generatedSecret = createTwoFactorSecret(username);
  const saveResult = await saveTwoFactorSetupSessionSecret(req, generatedSecret);
  if (!saveResult.ok) {
    return {
      ok: false,
      failure: saveResult.failure,
      log: {
        ...buildTwoFactorSetupSaveFailedLogAction(userId),
      },
    };
  }

  const responseBody = await buildTwoFactorSetupPayload(username, generatedSecret);
  return {
    ok: true,
    reused: false,
    response: {
      statusCode: 200,
      body: responseBody,
    },
    log: {
      ...buildTwoFactorSetupGeneratedLogAction(userId),
    },
  };
};
