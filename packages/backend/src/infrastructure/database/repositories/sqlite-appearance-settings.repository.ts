import type { AppearanceSettingsRepository } from '../../../modules/appearance/appearance-settings.repository.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

interface AppearanceRow {
  key: string;
  value: string;
  updated_at: number;
}

export class SqliteAppearanceSettingsRepository implements AppearanceSettingsRepository {
  constructor(private readonly database: RelationalDatabase) {}

  async list() {
    const rows = await this.database.queryAll<AppearanceRow>('SELECT key, value, updated_at FROM appearance_settings');
    return rows.map((row) => ({ key: row.key, value: row.value, updatedAt: row.updated_at }));
  }

  async ensure(values: Readonly<Record<string, string>>): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.database.transaction(async (database) => {
      for (const [key, value] of Object.entries(values)) {
        await database.execute(
          'INSERT OR IGNORE INTO appearance_settings (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)',
          [key, value, now, now],
        );
      }
    });
  }

  async setMany(values: Readonly<Record<string, string>>): Promise<boolean> {
    const entries = Object.entries(values);
    if (entries.length === 0) return false;
    const now = Math.floor(Date.now() / 1000);
    let changed = false;
    await this.database.transaction(async (database) => {
      for (const [key, value] of entries) {
        const result = await database.execute(
          `INSERT INTO appearance_settings (key, value, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          [key, value, now, now],
        );
        changed ||= result.changes > 0;
      }
    });
    return changed;
  }
}
