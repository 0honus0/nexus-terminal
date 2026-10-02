import type { NotificationSettingsRepository } from '../../../modules/notifications/notification.repository.port';
import type {
  CreateNotificationSetting,
  NotificationChannelConfig,
  NotificationChannelType,
  NotificationEvent,
  NotificationSetting,
  UpdateNotificationSetting,
} from '../../../modules/notifications/notification.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import type { SecretCipher } from '../../../shared/security/crypto.port';
import { protectOperationalSecret, readOperationalSecret } from '../../security/operational-secret-storage';
interface Row {
  id: number;
  channel_type: NotificationChannelType;
  name: string;
  enabled: number;
  config: string;
  enabled_events: string;
  created_at: number;
  updated_at: number;
}
const parse = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};
const map = (r: Row, cipher: SecretCipher): NotificationSetting => ({
  id: r.id,
  channelType: r.channel_type,
  name: r.name,
  enabled: Boolean(r.enabled),
  config: parse<NotificationChannelConfig>(readOperationalSecret(cipher, r.config), {} as NotificationChannelConfig),
  enabledEvents: parse<NotificationEvent[]>(r.enabled_events, []),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});
export class SqliteNotificationRepository implements NotificationSettingsRepository {
  constructor(
    private readonly database: RelationalDatabase,
    private readonly cipher: SecretCipher,
  ) {}
  async list() {
    return (await this.database.queryAll<Row>('SELECT * FROM notification_settings ORDER BY created_at ASC')).map(
      (row) => map(row, this.cipher),
    );
  }
  async get(id: number) {
    const row = await this.database.queryOne<Row>('SELECT * FROM notification_settings WHERE id=?', [id]);
    return row ? map(row, this.cipher) : null;
  }
  async listEnabledFor(event: NotificationEvent) {
    return (
      await this.database.queryAll<Row>(
        'SELECT * FROM notification_settings WHERE enabled=1 AND EXISTS (SELECT 1 FROM json_each(enabled_events) WHERE value=?) ORDER BY id ASC LIMIT 64',
        [event],
      )
    ).map((row) => map(row, this.cipher));
  }
  async create(s: CreateNotificationSetting) {
    return this.database.transaction(async (tx) => {
      const count = await tx.queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM notification_settings');
      if ((count?.total ?? 0) >= 64) throw new Error('NOTIFICATION_SETTING_LIMIT_EXCEEDED');
      const r = await tx.execute(
        "INSERT INTO notification_settings (channel_type,name,enabled,config,enabled_events,created_at,updated_at) VALUES (?,?,?,?,?,strftime('%s','now'),strftime('%s','now'))",
        [
          s.channelType,
          s.name,
          s.enabled ? 1 : 0,
          protectOperationalSecret(this.cipher, JSON.stringify(s.config)),
          JSON.stringify(s.enabledEvents),
        ],
      );
      if (!r.lastInsertId) throw new Error('Notification setting insert did not return an id.');
      return r.lastInsertId;
    });
  }
  async update(id: number, s: UpdateNotificationSetting) {
    const cols: Record<keyof UpdateNotificationSetting, string> = {
      channelType: 'channel_type',
      name: 'name',
      enabled: 'enabled',
      config: 'config',
      enabledEvents: 'enabled_events',
    };
    const e = Object.entries(s).filter(([, v]) => v !== undefined) as Array<[keyof UpdateNotificationSetting, unknown]>;
    if (!e.length) return true;
    const vals = e.map(([k, v]) =>
      k === 'enabled'
        ? v
          ? 1
          : 0
        : k === 'config'
          ? protectOperationalSecret(this.cipher, JSON.stringify(v))
          : k === 'enabledEvents'
            ? JSON.stringify(v)
            : v,
    );
    return (
      (
        await this.database.execute(
          `UPDATE notification_settings SET ${e.map(([k]) => `${cols[k]}=?`).join(',')},updated_at=strftime('%s','now') WHERE id=?`,
          [...vals, id],
        )
      ).changes > 0
    );
  }
  async delete(id: number) {
    return (await this.database.execute('DELETE FROM notification_settings WHERE id=?', [id])).changes > 0;
  }
}
