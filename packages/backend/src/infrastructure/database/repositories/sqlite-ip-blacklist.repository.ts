import type { IpBlacklistEntry, IpBlacklistRepository } from '../../../modules/auth/ip-blacklist.repository.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
interface Row {
  ip: string;
  attempts: number;
  last_attempt_at: number;
  blocked_until: number | null;
}
const map = (r: Row): IpBlacklistEntry => ({
  ip: r.ip,
  attempts: r.attempts,
  lastAttemptAt: r.last_attempt_at,
  blockedUntil: r.blocked_until,
});
export class SqliteIpBlacklistRepository implements IpBlacklistRepository {
  constructor(private readonly database: RelationalDatabase) {}
  async get(ip: string) {
    const r = await this.database.queryOne<Row>('SELECT * FROM ip_blacklist WHERE ip=?', [ip]);
    return r ? map(r) : null;
  }
  async recordFailure(ip: string, now: number, maxAttempts: number, duration: number) {
    return this.database.transaction(async (tx) => {
      const row = await tx.queryOne<Row>('SELECT * FROM ip_blacklist WHERE ip=?', [ip]);
      const expired = row?.blocked_until != null && row.blocked_until <= now;
      const active = row?.blocked_until != null && row.blocked_until > now;
      const attempts = (expired ? 0 : (row?.attempts ?? 0)) + 1;
      const newlyBlocked = attempts >= maxAttempts && !active;
      const e: IpBlacklistEntry = {
        ip,
        attempts,
        lastAttemptAt: now,
        blockedUntil: active ? row!.blocked_until : newlyBlocked ? now + duration : null,
      };
      await tx.execute(
        'INSERT INTO ip_blacklist (ip,attempts,last_attempt_at,blocked_until) VALUES (?,?,?,?) ON CONFLICT(ip) DO UPDATE SET attempts=excluded.attempts,last_attempt_at=excluded.last_attempt_at,blocked_until=excluded.blocked_until',
        [e.ip, e.attempts, e.lastAttemptAt, e.blockedUntil],
      );
      return { entry: e, newlyBlocked };
    });
  }
  async remove(ip: string) {
    return (await this.database.execute('DELETE FROM ip_blacklist WHERE ip=?', [ip])).changes > 0;
  }
  async list(limit: number, offset: number) {
    const [rows, count] = await Promise.all([
      this.database.queryAll<Row>('SELECT * FROM ip_blacklist ORDER BY last_attempt_at DESC LIMIT ? OFFSET ?', [
        limit,
        offset,
      ]),
      this.database.queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM ip_blacklist'),
    ]);
    return { entries: rows.map(map), total: count?.total ?? 0 };
  }
}
