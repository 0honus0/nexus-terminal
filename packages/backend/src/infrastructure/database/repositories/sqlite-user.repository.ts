import type { StoredUserRecord, UserRepository } from '../../../modules/user/user.repository.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
interface Row {
  id: number;
  username: string;
  hashed_password: string;
  two_factor_secret: string | null;
  created_at: number;
  updated_at: number;
}
const map = (r: Row): StoredUserRecord => ({
  id: r.id,
  username: r.username,
  hashedPassword: r.hashed_password,
  twoFactorSecret: r.two_factor_secret,
  hasTwoFactor: Boolean(r.two_factor_secret),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
export class SqliteUserRepository implements UserRepository {
  constructor(private readonly database: RelationalDatabase) {}
  async get(id: number) {
    const r = await this.database.queryOne<Row>(
      'SELECT id,username,hashed_password,two_factor_secret,created_at,updated_at FROM users WHERE id=?',
      [id],
    );
    return r ? map(r) : null;
  }
  async findByUsername(username: string) {
    const r = await this.database.queryOne<Row>(
      'SELECT id,username,hashed_password,two_factor_secret,created_at,updated_at FROM users WHERE username=?',
      [username],
    );
    return r ? map(r) : null;
  }
  async count() {
    return (await this.database.queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM users'))?.total ?? 0;
  }
  async create(username: string, hashedPassword: string) {
    const r = await this.database.execute(
      "INSERT INTO users (username,hashed_password,created_at,updated_at) VALUES (?,?,strftime('%s','now'),strftime('%s','now'))",
      [username, hashedPassword],
    );
    if (!r.lastInsertId) throw new Error('User insert did not return an id.');
    return r.lastInsertId;
  }
  async updatePassword(id: number, hash: string) {
    return (
      (
        await this.database.execute("UPDATE users SET hashed_password=?,updated_at=strftime('%s','now') WHERE id=?", [
          hash,
          id,
        ])
      ).changes > 0
    );
  }
  async updateTwoFactorSecret(id: number, secret: string | null) {
    return (
      (
        await this.database.execute("UPDATE users SET two_factor_secret=?,updated_at=strftime('%s','now') WHERE id=?", [
          secret,
          id,
        ])
      ).changes > 0
    );
  }
}
