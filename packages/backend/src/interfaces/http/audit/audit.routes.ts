import { Router } from 'express';
import { AUDIT_ACTION_TYPES, type AuditLogPageDto, type AuditLogQueryDto } from '@nexus-terminal/protocol/audit';
import type { AuditLogService } from '../../../modules/audit/audit.service';
import type { AuditLogActionType } from '../../../modules/audit/audit.types';
import { requireAuthenticated } from '../auth/auth.middleware';
import { route } from '../shared/route-handler';

const auditActionTypes = new Set<AuditLogActionType>(AUDIT_ACTION_TYPES);

const readAuditActionType = (value: unknown): AuditLogActionType | undefined => {
  if (typeof value !== 'string') return undefined;
  if (!auditActionTypes.has(value as AuditLogActionType)) throw new Error('无效的审计操作类型');
  return value as AuditLogActionType;
};

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
      const query: AuditLogQueryDto = {
        limit,
        offset,
        search: typeof q.query.search === 'string' ? q.query.search : undefined,
        actionType: typeof q.query.actionType === 'string' ? q.query.actionType : undefined,
        startDate: start,
        endDate: end,
      };
      let actionType: AuditLogActionType | undefined;
      try {
        actionType = readAuditActionType(query.actionType);
      } catch {
        s.status(400).json({ message: '无效的审计操作类型' });
        return;
      }
      const result = await audit.getLogs(limit, offset, actionType, start, end, query.search);
      const payload: AuditLogPageDto = {
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
      };
      s.json(payload);
    }),
  );
  return r;
};
