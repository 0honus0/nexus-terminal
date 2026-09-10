import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { agentData, agentError, agentRequestId } from './agent-http';

export interface AgentSecurityOptions {
  nodeEnv: string;
  publicOrigin?: string;
}

export const agentUserId = (request: Request): number => {
  const value = request.session.userId;
  if (!value) throw new Error('AUTH_REQUIRED');
  return value;
};

export const requireAgentAuthenticated: RequestHandler = (request, response, next): void => {
  agentRequestId(request, response);
  if (request.session.userId && request.session.username && request.session.requiresTwoFactor !== true) {
    next();
    return;
  }
  agentError(request, response, 401, 'AUTH_REQUIRED', 'Authentication is required.');
};

const loopbackOrigin = (origin: string): boolean => {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
};

const tokenMatches = (expected: string | undefined, supplied: string | undefined): boolean => {
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
};

export const createAgentMutationSecurity =
  (options: AgentSecurityOptions): RequestHandler =>
  (request: Request, response: Response, next: NextFunction): void => {
    if (request.header('sec-fetch-site') === 'cross-site') {
      agentError(request, response, 403, 'CSRF_REJECTED', 'Cross-site Agent mutation is not allowed.');
      return;
    }

    const origin = request.header('origin');
    if (options.nodeEnv === 'production' && !options.publicOrigin) {
      agentError(request, response, 403, 'CSRF_REJECTED', 'Agent mutation origin is not configured.');
      return;
    }
    if (origin) {
      const allowed = options.publicOrigin
        ? origin === options.publicOrigin
        : options.nodeEnv !== 'production' && loopbackOrigin(origin);
      if (!allowed) {
        agentError(request, response, 403, 'CSRF_REJECTED', 'Agent mutation origin is not allowed.');
        return;
      }
    }

    if (!tokenMatches(request.session.agentCsrfToken, request.header('x-nexus-csrf'))) {
      agentError(request, response, 403, 'CSRF_REJECTED', 'A valid Agent CSRF token is required.');
      return;
    }
    next();
  };

export const issueAgentCsrf = (request: Request, response: Response): void => {
  request.session.agentCsrfToken ??= randomBytes(32).toString('hex');
  response.setHeader('Cache-Control', 'no-store');
  agentData(request, response, { token: request.session.agentCsrfToken });
};
