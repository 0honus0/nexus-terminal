import { Request } from 'express';
import {
  buildTwoFactorSetupPayload,
  type SetupPayload,
  createTwoFactorSecret,
} from './auth-two-factor-flow.utils';
import { saveTwoFactorSetupSessionSecret } from './auth-2fa-state-flow.utils';

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
  const sessionTempSecret = req.session.tempTwoFactorSecret;

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
        level: 'debug',
        message: `[AuthController] 用户 ${userId} 复用已存在的临时 2FA 密钥，直接返回 setup payload。`,
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
        level: 'error',
        message: `[AuthController] 用户 ${userId} 保存临时 2FA 密钥到 session 失败`,
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
      level: 'info',
      message: `[AuthController] 用户 ${userId} 生成新的临时 2FA 密钥并返回 setup payload。`,
    },
  };
};
