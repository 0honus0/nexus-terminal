import type {
  SettingsMigrationPatch,
  SettingsMigrationRepository,
} from '../../../modules/settings/settings-migration.repository.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';

export class SqliteSettingsMigrationRepository implements SettingsMigrationRepository {
  constructor(private readonly db: RelationalDatabase) {}

  async getCurrentVersion(): Promise<number> {
    const row = await this.db.queryOne<{ version: number | null }>(
      'SELECT MAX(version) AS version FROM settings_migrations',
    );
    return row?.version ?? 0;
  }

  async apply(version: number, name: string, patch: SettingsMigrationPatch): Promise<void> {
    await this.db.transaction(async (tx) => {
      const now = Math.floor(Date.now() / 1000);
      for (const [key, value] of Object.entries(patch.set ?? {})) {
        await tx.execute(
          'INSERT INTO settings (key,value,created_at,updated_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',
          [key, value, now, now],
        );
      }
      for (const key of patch.remove ?? []) await tx.execute('DELETE FROM settings WHERE key=?', [key]);
      await tx.execute('INSERT INTO settings_migrations (version,name,applied_at) VALUES (?,?,?)', [
        version,
        name,
        now,
      ]);
    });
  }
}
