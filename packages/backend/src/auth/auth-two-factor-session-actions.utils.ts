import { Request } from 'express';

export const readTwoFactorSessionSecret = (req: Request): string | undefined =>
  req.session.tempTwoFactorSecret;

export const setTwoFactorSessionSecret = (req: Request, secret: string): void => {
  req.session.tempTwoFactorSecret = secret;
};

export const syncTwoFactorSessionSecret = (payload: { req: Request; secret: string }): boolean => {
  const { req, secret } = payload;
  if (!secret || req.session.tempTwoFactorSecret === secret) {
    return false;
  }

  req.session.tempTwoFactorSecret = secret;
  return true;
};

export const clearTwoFactorSessionSecret = (req: Request): boolean => {
  if (typeof req.session.tempTwoFactorSecret === 'undefined') {
    return false;
  }

  delete req.session.tempTwoFactorSecret;
  return true;
};
