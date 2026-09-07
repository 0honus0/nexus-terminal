import type { NextFunction, Request, Response } from 'express';
import type { IpBlacklistService } from '../../../modules/auth/ip-blacklist.service';

export const requireAuthenticated = (request: Request, response: Response, next: NextFunction): void => {
  if (request.session.userId && request.session.username && request.session.requiresTwoFactor !== true) {
    next();
    return;
  }
  response.status(401).json({ message: '未授权：请先登录。' });
};

export const createIpBlacklistCheck =
  (blacklist: IpBlacklistService) =>
  async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    const ip = request.ip || request.socket.remoteAddress;
    if (!ip) {
      response.status(403).json({ message: '禁止访问：无法识别来源 IP。' });
      return;
    }
    try {
      if (await blacklist.isBlocked(ip)) {
        response.status(403).json({ message: '访问被拒绝。' });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
