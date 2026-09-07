import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import type { AuditLogRepository } from '../../../modules/audit/audit.repository.port';
import type { AuditLogActionType, AuditLogEntry } from '../../../modules/audit/audit.types';

type AuditLogRow = { id: number; timestamp: number; action_type: AuditLogActionType; details: string | null };
const mapAuditLog = (row: AuditLogRow): AuditLogEntry => ({
  id: row.id,
  timestamp: row.timestamp,
  actionType: row.action_type,
  details: row.details,
});

export class SqliteAuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: RelationalDatabase) {}
  async add(actionType: AuditLogActionType, details?: Record<string, unknown> | string | null) {
    let value: string | null = null;
    if (details !== undefined && details !== null) {
      try {
        value = typeof details === 'string' ? details : JSON.stringify(details);
      } catch {
        value = JSON.stringify({ error: 'Failed to stringify details' });
      }
    }
    await this.db.execute('INSERT INTO audit_logs (timestamp,action_type,details) VALUES (?,?,?)', [
      Math.floor(Date.now() / 1000),
      actionType,
      value,
    ]);
    const count = (await this.db.queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM audit_logs'))?.total ?? 0;
    if (count > 50000)
      await this.db.execute(
        'DELETE FROM audit_logs WHERE id IN (SELECT id FROM audit_logs ORDER BY timestamp ASC LIMIT ?)',
        [count - 50000],
      );
  }
  async list(options: {
    limit: number;
    offset: number;
    actionType?: AuditLogActionType;
    startDate?: number;
    endDate?: number;
    searchTerm?: string;
  }) {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (options.actionType) {
      where.push('action_type=?');
      params.push(options.actionType);
    }
    if (options.startDate !== undefined) {
      where.push('timestamp>=?');
      params.push(options.startDate);
    }
    if (options.endDate !== undefined) {
      where.push('timestamp<=?');
      params.push(options.endDate);
    }
    if (options.searchTerm) {
      where.push('details LIKE ?');
      params.push(`%${options.searchTerm}%`);
    }
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const total =
      (await this.db.queryOne<{ total: number }>(`SELECT COUNT(*) AS total FROM audit_logs${clause}`, params))?.total ??
      0;
    const logs = (
      await this.db.queryAll<AuditLogRow>(
        `SELECT id,timestamp,action_type,details FROM audit_logs${clause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
        [...params, options.limit, options.offset],
      )
    ).map(mapAuditLog);
    return { logs, total };
  }
}
