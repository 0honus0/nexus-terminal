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
    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    try {
      if (await blacklist.isBlocked(ip)) {
        response.status(403).json({ message: '此 IP 地址因多次登录失败已被暂时封禁。' });
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
