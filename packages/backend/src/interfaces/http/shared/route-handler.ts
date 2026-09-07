import type { NextFunction, Request, RequestHandler, Response } from 'express';

export type AsyncRouteHandler = (request: Request, response: Response, next: NextFunction) => void | Promise<void>;

export const route =
  (handler: AsyncRouteHandler): RequestHandler =>
  (request, response, next) => {
    void Promise.resolve(handler(request, response, next)).catch(next);
  };

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const parsePositiveId = (value: string): number | null => {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};
