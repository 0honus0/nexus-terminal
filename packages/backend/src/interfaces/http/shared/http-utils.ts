import type { Request, Response } from 'express';

export const requestIp = (request: Request): string => request.ip || request.socket.remoteAddress || 'unknown';

export const parsePositiveId = (value: string): number | null => {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const destroySession = (request: Request): Promise<void> =>
  new Promise((resolve, reject) => request.session.destroy((error) => (error ? reject(error) : resolve())));

export const regenerateSession = (request: Request): Promise<void> =>
  new Promise((resolve, reject) => request.session.regenerate((error) => (error ? reject(error) : resolve())));

export const respondServerError = (response: Response, message: string, error: unknown): void => {
  response.status(500).json({ message, error: errorMessage(error) });
};
