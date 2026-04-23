import { Request, Response } from 'express';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';

export interface SetupPayload {
  secret: string;
  qrCodeUrl: string;
}

const buildTwoFactorOtpAuthUrl = (username: string, secret: string): string =>
  speakeasy.otpauthURL({
    secret,
    encoding: 'base32',
    label: `NexusTerminal (${username})`,
    issuer: 'NexusTerminal',
  });

export const buildTwoFactorSetupPayload = async (
  username: string,
  secret: string
): Promise<SetupPayload> => {
  const qrCodeUrl = await qrcode.toDataURL(buildTwoFactorOtpAuthUrl(username, secret));
  return { secret, qrCodeUrl };
};

export const createTwoFactorSecret = (username: string): string => {
  const secret = speakeasy.generateSecret({
    length: 20,
    name: `NexusTerminal (${username})`,
  });
  return secret.base32;
};

export const respondWithExistingTwoFactorSetup = async (
  req: Request,
  res: Response,
  username: string
): Promise<boolean> => {
  const sessionTempSecret = req.session.tempTwoFactorSecret;
  if (!sessionTempSecret) {
    return false;
  }

  const payload = await buildTwoFactorSetupPayload(username, sessionTempSecret);
  res.json(payload);
  return true;
};

export const saveTwoFactorSecretAndRespond = async (
  req: Request,
  res: Response,
  payload: {
    userId: number;
    username: string;
    secret: string;
  }
): Promise<void> => {
  const { userId, username, secret } = payload;
  req.session.tempTwoFactorSecret = secret;

  const responsePayload = await buildTwoFactorSetupPayload(username, secret);
  req.session.save((saveErr) => {
    if (saveErr) {
      console.error(`[AuthController] 用户 ${userId} 保存临时 2FA 密钥到 session 失败:`, saveErr);
      res.status(500).json({ message: '保存两步验证状态失败，请重试。' });
      return;
    }

    res.json(responsePayload);
  });
};

export interface TwoFactorEffectiveSecretResult {
  effectiveSecret: string;
  secretProvidedByBody: boolean;
  sessionSecretMismatched: boolean;
}

export const resolveTwoFactorEffectiveSecret = (payload: {
  req: Request;
  tempSecret: string;
  providedSecret: string;
}): TwoFactorEffectiveSecretResult => {
  const { req, tempSecret, providedSecret } = payload;
  const effectiveSecret = providedSecret || tempSecret;
  const secretProvidedByBody = Boolean(providedSecret);
  const sessionSecretMismatched =
    Boolean(providedSecret) && Boolean(tempSecret) && providedSecret !== tempSecret;

  if (providedSecret && req.session.tempTwoFactorSecret !== providedSecret) {
    req.session.tempTwoFactorSecret = providedSecret;
  }

  return {
    effectiveSecret,
    secretProvidedByBody,
    sessionSecretMismatched,
  };
};

export type TwoFactorTokenVerificationResult =
  | {
      status: 'verified';
      delta: number;
    }
  | {
      status: 'time_skew';
      delta: number;
      skewSeconds: number;
    }
  | {
      status: 'invalid';
    };

export const verifyTwoFactorTokenWithSkew = (payload: {
  secret: string;
  token: string;
  verifyWindow: number;
  skewDetectWindow: number;
  skewWarnThreshold: number;
}): TwoFactorTokenVerificationResult => {
  const { secret, token, verifyWindow, skewDetectWindow, skewWarnThreshold } = payload;

  const verificationDelta = speakeasy.totp.verifyDelta({
    secret,
    encoding: 'base32',
    token,
    window: verifyWindow,
  });
  if (verificationDelta !== undefined) {
    return {
      status: 'verified',
      delta: verificationDelta.delta ?? 0,
    };
  }

  const relaxedDelta = speakeasy.totp.verifyDelta({
    secret,
    encoding: 'base32',
    token,
    window: skewDetectWindow,
  });
  if (relaxedDelta && Math.abs(relaxedDelta.delta) >= skewWarnThreshold) {
    return {
      status: 'time_skew',
      delta: relaxedDelta.delta,
      skewSeconds: Math.abs(relaxedDelta.delta) * 30,
    };
  }

  return { status: 'invalid' };
};
