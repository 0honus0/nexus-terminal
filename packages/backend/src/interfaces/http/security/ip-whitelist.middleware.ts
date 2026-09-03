import type { NextFunction, Request, Response } from 'express';
import type { IpWhitelistService } from '../../../modules/auth/ip-whitelist.service';

export const createIpWhitelistMiddleware =
  (policy: IpWhitelistService) =>
  async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    const decision = await policy.check(request.ip || request.socket.remoteAddress);
    if (decision.allowed) {
      next();
      return;
    }
    response.status(decision.statusCode).json({ message: decision.message });
  };
