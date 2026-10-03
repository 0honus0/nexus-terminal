import type { RequestHandler } from 'express';

/** Browser authority is distinct from cookie authentication and source IP admission. */
export const mutationOriginSecurity: RequestHandler = (request, response, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
  const site = request.get('sec-fetch-site');
  const origin = request.get('origin');
  let allowed = !origin && (!site || site === 'same-origin');
  if (origin) {
    try {
      const parsed = new URL(origin);
      allowed = origin === parsed.origin && parsed.origin === new URL(`${request.protocol}://${request.host}`).origin;
    } catch {
      allowed = false;
    }
  }
  if (site === 'cross-site' || site === 'same-site') allowed = false;
  if (!allowed) {
    response.status(403).json({ code: 'CSRF_REJECTED', message: 'Mutation origin is not allowed.' });
    return;
  }
  next();
};
