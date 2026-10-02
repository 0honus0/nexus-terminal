import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import type { SettingRecord, SettingsRepository } from '../../../modules/settings/settings.repository.port';
import type { SecretCipher } from '../../../shared/security/crypto.port';
import { protectOperationalSecret, readOperationalSecret } from '../../security/operational-secret-storage';
export class SqliteSettingsRepository implements SettingsRepository {
  constructor(
    private readonly db: RelationalDatabase,
    private readonly cipher: SecretCipher,
  ) {}
  async list(): Promise<SettingRecord[]> {
    return (await this.db.queryAll<SettingRecord>('SELECT key,value FROM settings')).map((row) => ({
      ...row,
      value: row.key === 'captchaConfig' ? readOperationalSecret(this.cipher, row.value) : row.value,
    }));
  }
  async get(key: string): Promise<string | null> {
    const value = (await this.db.queryOne<{ value: string }>('SELECT value FROM settings WHERE key=?', [key]))?.value;
    return value === undefined ? null : key === 'captchaConfig' ? readOperationalSecret(this.cipher, value) : value;
  }
  async set(key: string, value: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.db.execute(
      'INSERT INTO settings (key,value,created_at,updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',
      [key, key === 'captchaConfig' ? protectOperationalSecret(this.cipher, value) : value, now, now],
    );
  }
  async setMany(values: Record<string, string>): Promise<void> {
    await this.db.transaction(async (tx) => {
      const now = Math.floor(Date.now() / 1000);
      for (const [key, value] of Object.entries(values))
        await tx.execute(
          'INSERT INTO settings (key,value,created_at,updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',
          [key, key === 'captchaConfig' ? protectOperationalSecret(this.cipher, value) : value, now, now],
        );
    });
  }
  async delete(key: string): Promise<boolean> {
    return (await this.db.execute('DELETE FROM settings WHERE key=?', [key])).changes > 0;
  }
}
