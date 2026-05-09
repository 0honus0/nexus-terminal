/**
 * 数据备份服务
 * 提供导出/导入核心业务数据的能力
 */

import { getDbInstance, allDb, runDb } from '../database/connection';
import {
  BACKUP_FORMAT_VERSION,
  type BackupMetadata,
  type BackupPayload,
  type ImportOptions,
  type ImportResult,
} from './backup.types';

/** 需要备份的表及其导出 SQL */
const EXPORT_TABLES: Record<keyof Omit<BackupPayload, 'metadata'>, string> = {
  connections: 'SELECT * FROM connections',
  sshKeys: 'SELECT * FROM ssh_keys',
  proxies: 'SELECT * FROM proxies',
  tags: 'SELECT * FROM tags',
  connectionTags: 'SELECT * FROM connection_tags',
  quickCommands: 'SELECT * FROM quick_commands',
  quickCommandTags: 'SELECT * FROM quick_command_tags',
  quickCommandTagAssociations: 'SELECT * FROM quick_command_tag_associations',
  terminalThemes: 'SELECT * FROM terminal_themes',
  notificationSettings: 'SELECT * FROM notification_settings',
  settings: "SELECT * FROM settings WHERE key NOT IN ('encryptionKeyVersion', 'encryptionKey')",
  appearanceSettings: 'SELECT * FROM appearance_settings',
  favoritePaths: 'SELECT * FROM favorite_paths',
};

/** 导入表的插入语句模板（INSERT OR IGNORE 防止重复） */
const IMPORT_TABLES: Record<
  keyof Omit<BackupPayload, 'metadata'>,
  { table: string; columns: string[] }
> = {
  connections: {
    table: 'connections',
    columns: [
      'name',
      'type',
      'host',
      'port',
      'username',
      'auth_method',
      'encrypted_password',
      'encrypted_private_key',
      'encrypted_passphrase',
      'proxy_id',
      'ssh_key_id',
      'notes',
      'jump_chain',
      'proxy_type',
      'force_keyboard_interactive',
    ],
  },
  sshKeys: {
    table: 'ssh_keys',
    columns: ['name', 'encrypted_private_key', 'encrypted_passphrase'],
  },
  proxies: {
    table: 'proxies',
    columns: [
      'name',
      'type',
      'host',
      'port',
      'username',
      'auth_method',
      'encrypted_password',
      'encrypted_private_key',
      'encrypted_passphrase',
    ],
  },
  tags: { table: 'tags', columns: ['name'] },
  connectionTags: { table: 'connection_tags', columns: ['connection_id', 'tag_id'] },
  quickCommands: {
    table: 'quick_commands',
    columns: ['name', 'command', 'usage_count', 'variables'],
  },
  quickCommandTags: { table: 'quick_command_tags', columns: ['name'] },
  quickCommandTagAssociations: {
    table: 'quick_command_tag_associations',
    columns: ['quick_command_id', 'tag_id'],
  },
  terminalThemes: {
    table: 'terminal_themes',
    columns: [
      'name',
      'theme_type',
      'foreground',
      'background',
      'cursor',
      'cursor_accent',
      'selection_background',
      'black',
      'red',
      'green',
      'yellow',
      'blue',
      'magenta',
      'cyan',
      'white',
      'bright_black',
      'bright_red',
      'bright_green',
      'bright_yellow',
      'bright_blue',
      'bright_magenta',
      'bright_cyan',
      'bright_white',
      'created_at',
      'updated_at',
    ],
  },
  notificationSettings: {
    table: 'notification_settings',
    columns: [
      'channel_type',
      'name',
      'enabled',
      'config',
      'enabled_events',
      'created_at',
      'updated_at',
    ],
  },
  settings: { table: 'settings', columns: ['key', 'value'] },
  appearanceSettings: { table: 'appearance_settings', columns: ['key', 'value'] },
  favoritePaths: {
    table: 'favorite_paths',
    columns: ['name', 'path', 'last_used_at', 'created_at', 'updated_at'],
  },
};

/** 导出所有核心业务数据 */
export async function exportData(): Promise<BackupPayload> {
  const db = await getDbInstance();
  const result: BackupPayload = {
    metadata: {
      version: BACKUP_FORMAT_VERSION,
      exportedAt: Date.now(),
      recordCounts: {},
    },
    connections: [],
    sshKeys: [],
    proxies: [],
    tags: [],
    connectionTags: [],
    quickCommands: [],
    quickCommandTags: [],
    quickCommandTagAssociations: [],
    terminalThemes: [],
    notificationSettings: [],
    settings: [],
    appearanceSettings: [],
    favoritePaths: [],
  };

  for (const [key, sql] of Object.entries(EXPORT_TABLES)) {
    const rows = await allDb<Record<string, unknown>>(db, sql);
    (result as unknown as Record<string, unknown>)[key] = rows;
    result.metadata.recordCounts[key] = rows.length;
  }

  return result;
}

/** 从备份数据导入到数据库（事务性：失败时回滚） */
export async function importData(
  payload: BackupPayload,
  options: ImportOptions = {}
): Promise<ImportResult> {
  const db = await getDbInstance();
  const { overwrite = false, tables } = options;
  const result: ImportResult = { imported: {}, skipped: {}, errors: [] };

  const tablesToImport =
    tables || (Object.keys(IMPORT_TABLES) as (keyof Omit<BackupPayload, 'metadata'>)[]);

  // 使用事务确保导入原子性：任何失败自动回滚
  await runDb(db, 'BEGIN TRANSACTION');

  try {
    for (const key of tablesToImport) {
      const config = IMPORT_TABLES[key];
      if (!config) {
        result.errors.push(`未知的表: ${key}`);
        continue;
      }

      const rows = (payload as unknown as Record<string, unknown[]>)[key];
      if (!Array.isArray(rows) || rows.length === 0) {
        result.imported[key] = 0;
        result.skipped[key] = 0;
        continue;
      }

      let imported = 0;
      let skipped = 0;

      const placeholders = config.columns.map(() => '?').join(', ');
      const insertSql = overwrite
        ? `INSERT OR REPLACE INTO ${config.table} (${config.columns.join(', ')}) VALUES (${placeholders})`
        : `INSERT OR IGNORE INTO ${config.table} (${config.columns.join(', ')}) VALUES (${placeholders})`;

      for (const row of rows) {
        try {
          const values = config.columns.map((col) => (row as Record<string, unknown>)[col] ?? null);
          const { changes } = await runDb(db, insertSql, values);
          if (changes > 0) imported++;
          else skipped++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          // 仅忽略约束冲突类错误，其余向上抛出触发回滚
          if (msg.includes('UNIQUE') || msg.includes('constraint') || msg.includes('NOT NULL')) {
            result.errors.push(`${key} 导入失败: ${msg}`);
            skipped++;
          } else {
            throw err;
          }
        }
      }

      result.imported[key] = imported;
      result.skipped[key] = skipped;
    }

    // 有错误时回滚，否则提交
    if (result.errors.length > 0) {
      await runDb(db, 'ROLLBACK');
      // 回滚后数据未实际落库，清空统计避免误导调用方
      result.imported = {};
      result.skipped = {};
    } else {
      await runDb(db, 'COMMIT');
    }
  } catch (err: unknown) {
    await runDb(db, 'ROLLBACK').catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`导入事务失败，已回滚: ${msg}`);
  }

  return result;
}

/** 获取备份文件的预览信息（不执行导入） */
export function validateBackup(payload: unknown): {
  valid: boolean;
  metadata?: BackupMetadata;
  error?: string;
} {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: '无效的备份数据格式' };
  }

  const data = payload as Record<string, unknown>;
  if (!data.metadata || typeof data.metadata !== 'object') {
    return { valid: false, error: '缺少备份元信息' };
  }

  const meta = data.metadata as BackupMetadata;
  if (typeof meta.version !== 'number' || meta.version < 1) {
    return { valid: false, error: `不支持的备份版本: ${meta.version}` };
  }

  if (meta.version > BACKUP_FORMAT_VERSION) {
    return {
      valid: false,
      error: `备份版本 ${meta.version} 高于当前支持的版本 ${BACKUP_FORMAT_VERSION}`,
    };
  }

  return { valid: true, metadata: meta };
}
