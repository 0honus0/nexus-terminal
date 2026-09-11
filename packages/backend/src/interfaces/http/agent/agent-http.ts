import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { mapAgentError } from './agent-error-rules';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AgentAsyncRoute = (request: Request, response: Response, next: NextFunction) => void | Promise<void>;

export const agentRequestId = (request: Request, response: Response): string => {
  const existing = response.locals.agentRequestId;
  if (typeof existing === 'string') return existing;
  const supplied = request.header('x-request-id');
  const requestId = supplied && UUID.test(supplied) ? supplied : randomUUID();
  response.locals.agentRequestId = requestId;
  response.setHeader('X-Request-Id', requestId);
  return requestId;
};

export const agentData = (request: Request, response: Response, data: unknown, status = 200): void => {
  response.status(status).json({ data, requestId: agentRequestId(request, response) });
};

export const agentError = (
  request: Request,
  response: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void => {
  response.status(status).json({
    error: { code, message, ...(details === undefined ? {} : { details }) },
    requestId: agentRequestId(request, response),
  });
};

export const agentRoute =
  (handler: AgentAsyncRoute): RequestHandler =>
  (request, response, next) => {
    agentRequestId(request, response);
    void Promise.resolve(handler(request, response, next)).catch((error) => {
      const mapped = mapAgentError(error);
      if (mapped.status === 500) console.error('[Agent HTTP] Unhandled route error:', error);
      if (!response.headersSent)
        agentError(request, response, mapped.status, mapped.code, mapped.message, mapped.details);
    });
  };
