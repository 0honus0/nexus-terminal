import { Router } from 'express';
import type { AuditLogService } from '../../../modules/audit/audit.service';
import type { AuditLogActionType } from '../../../modules/audit/audit.types';
import { requireAuthenticated } from '../auth/auth.middleware';
import { route } from '../shared/route-handler';
export const createAuditRouter = (audit: AuditLogService): Router => {
  const r = Router();
  r.use(requireAuthenticated);
  r.get(
    '/',
    route(async (q, s) => {
      const limit = Number.parseInt(typeof q.query.limit === 'string' ? q.query.limit : '50', 10),
        offset = Number.parseInt(typeof q.query.offset === 'string' ? q.query.offset : '0', 10);
      if (!Number.isInteger(limit) || limit <= 0 || !Number.isInteger(offset) || offset < 0) {
        s.status(400).json({ message: '无效的分页参数' });
        return;
      }
      const start = q.query.startDate === undefined ? undefined : Number.parseInt(String(q.query.startDate), 10),
        end = q.query.endDate === undefined ? undefined : Number.parseInt(String(q.query.endDate), 10);
      if ((start !== undefined && !Number.isFinite(start)) || (end !== undefined && !Number.isFinite(end))) {
        s.status(400).json({ message: '无效的日期参数' });
        return;
      }
      const result = await audit.getLogs(
        limit,
        offset,
        typeof q.query.actionType === 'string' ? (q.query.actionType as AuditLogActionType) : undefined,
        start,
        end,
        typeof q.query.search === 'string' ? q.query.search : undefined,
      );
      s.json({
        logs: result.logs.map((log) => {
          let details: unknown = null;
          if (log.details) {
            try {
              details = JSON.parse(log.details);
            } catch {
              details = { raw: log.details, parseError: true };
            }
          }
          return { ...log, details };
        }),
        total: result.total,
        limit,
        offset,
      });
    }),
  );
  return r;
};
