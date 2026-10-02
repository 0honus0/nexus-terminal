import type { DatabaseSync as Database } from 'node:sqlite';
import { logger } from '../../../shared/logging/logger';
import type { SqliteMigration } from './migration.types';
import { tableExists, columnExists, getTableCreateSQL } from './schema-inspection';

export const coreMigrations: SqliteMigration[] = [
  {
    id: 1,
    name: 'Add ssh_keys table and update connections table for SSH key management',
    check: async (db: Database): Promise<boolean> => {
      const sshKeysTableExists = await tableExists(db, 'ssh_keys');
      const connectionsTableExists = await tableExists(db, 'connections'); // 确保 connections 表存在再检查列
      const sshKeyIdColumnExists = connectionsTableExists ? await columnExists(db, 'connections', 'ssh_key_id') : false;
      // 如果 ssh_keys 表不存在 或 connections 表的 ssh_key_id 列不存在，则需要运行迁移
      return !sshKeysTableExists || !sshKeyIdColumnExists;
    },
    sql: `
            -- 创建 ssh_keys 表 (使用 IF NOT EXISTS 保证幂等性)
            CREATE TABLE IF NOT EXISTS ssh_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                encrypted_private_key TEXT NOT NULL,
                encrypted_passphrase TEXT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            );

            -- 为 connections 表添加 ssh_key_id 列及外键 (如果列不存在)
            -- 注意: 直接 ALTER TABLE 添加列在列已存在时会抛出 "duplicate column name" 错误。
            --       迁移运行器 (runMigrations) 已配置为忽略此特定错误。
            ALTER TABLE connections ADD COLUMN ssh_key_id INTEGER NULL REFERENCES ssh_keys(id) ON DELETE SET NULL;

            -- 可选: 对旧数据进行清理或更新
            -- UPDATE connections SET encrypted_private_key = NULL WHERE encrypted_private_key = ''; -- 示例
            -- UPDATE connections SET encrypted_passphrase = NULL WHERE encrypted_passphrase = ''; -- 示例
        `,
  },
  {
    id: 2,
    name: 'Create quick_command_tags table',
    check: async (db: Database): Promise<boolean> => {
      const tableAlreadyExists = await tableExists(db, 'quick_command_tags');
      return !tableAlreadyExists; // Only run if the table does NOT exist
    },
    sql: `
            CREATE TABLE IF NOT EXISTS quick_command_tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            );
        `,
  },
  {
    id: 3,
    name: 'Create quick_command_tag_associations table',
    check: async (db: Database): Promise<boolean> => {
      const tableAlreadyExists = await tableExists(db, 'quick_command_tag_associations');
      return !tableAlreadyExists; // Only run if the table does NOT exist
    },
    sql: `
            CREATE TABLE IF NOT EXISTS quick_command_tag_associations (
                quick_command_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY (quick_command_id, tag_id),
                FOREIGN KEY (quick_command_id) REFERENCES quick_commands(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES quick_command_tags(id) ON DELETE CASCADE
            );
        `,
  },
  {
    id: 4,
    name: 'Add notes column to connections table',
    check: async (db: Database): Promise<boolean> => {
      const notesColumnExists = await columnExists(db, 'connections', 'notes');
      return !notesColumnExists;
    },
    sql: `
            -- Add the notes column to the connections table, allowing NULL values
            ALTER TABLE connections ADD COLUMN notes TEXT NULL;
        `,
  },
  {
    id: 5,
    name: 'Update connections table to allow VNC type in CHECK constraint',
    check: async (db: Database): Promise<boolean> => {
      const createSQL = await getTableCreateSQL(db, 'connections');
      if (createSQL) {
        // 检查 CHECK 约束是否已经包含了 VNC
        // 这会检查 'VNC' 是否是允许的类型之一
        // 例如: CHECK(type IN ('SSH', 'RDP', 'VNC'))
        const constraintRegex = /CHECK\s*\(\s*LOWER\(type\)\s+IN\s*\(([^)]+)\)\s*\)/i; // 兼容大小写不敏感的检查
        const constraintRegexStrict = /CHECK\s*\(\s*type\s+IN\s*\(([^)]+)\)\s*\)/i;

        let match = createSQL.match(constraintRegex);
        if (!match) {
          match = createSQL.match(constraintRegexStrict);
        }

        if (match && match[1]) {
          const allowedTypes = match[1].split(',').map((t) => t.trim().replace(/'/g, '').toLowerCase());
          return !allowedTypes.includes('vnc'); // 如果 'vnc' 不在允许类型中，则需要运行迁移
        }
        // 如果没有找到明确的 CHECK 约束或格式不匹配，保守地运行迁移
        logger.warn(
          '[Migrations] Check for VNC in connections.type: Could not parse CHECK constraint from SQL. Assuming migration is needed.',
        );
        return true;
      }
      logger.warn(
        '[Migrations] Check for VNC in connections.type: Could not get table create SQL. Assuming migration is needed.',
      );
      return true; // 如果表不存在或无法获取 SQL，则运行迁移
    },
    sql: `
            PRAGMA foreign_keys=off;

            -- 步骤 1: 重命名旧表
            ALTER TABLE connections RENAME TO connections_old_for_vnc_constraint_update;
            ALTER TABLE connection_tags RENAME TO connection_tags_old_for_vnc_constraint_update;

            -- 步骤 2: 创建新表 (与 schema.ts 中的定义一致)
            CREATE TABLE connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NULL,
                type TEXT NOT NULL CHECK(type IN ('SSH', 'RDP', 'VNC')) DEFAULT 'SSH',
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                username TEXT NOT NULL,
                auth_method TEXT NOT NULL CHECK(auth_method IN ('password', 'key')),
                encrypted_password TEXT NULL,
                encrypted_private_key TEXT NULL,
                encrypted_passphrase TEXT NULL,
                proxy_id INTEGER NULL,
                ssh_key_id INTEGER NULL,
                notes TEXT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                last_connected_at INTEGER NULL,
                FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL,
                FOREIGN KEY (ssh_key_id) REFERENCES ssh_keys(id) ON DELETE SET NULL
            );

            CREATE TABLE connection_tags (
                connection_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY (connection_id, tag_id),
                FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            );

            -- 步骤 3: 从旧表复制数据到新表
            INSERT INTO connections (
                id, name, type, host, port, username, auth_method,
                encrypted_password, encrypted_private_key, encrypted_passphrase,
                proxy_id, ssh_key_id, notes, created_at, updated_at, last_connected_at
            )
            SELECT
                id, name,
                CASE
                    WHEN UPPER(type) = 'RDP' THEN 'RDP'
                    WHEN UPPER(type) = 'SSH' THEN 'SSH'
                    WHEN UPPER(type) = 'VNC' THEN 'VNC'
                    ELSE 'SSH'
                END,
                host, port, username, auth_method,
                encrypted_password, encrypted_private_key, encrypted_passphrase,
                proxy_id, ssh_key_id, notes, created_at, updated_at, last_connected_at
            FROM connections_old_for_vnc_constraint_update;

            INSERT INTO connection_tags (connection_id, tag_id)
            SELECT connection_id, tag_id FROM connection_tags_old_for_vnc_constraint_update;

            -- 步骤 4: 删除旧表
            DROP TABLE connections_old_for_vnc_constraint_update;
            DROP TABLE connection_tags_old_for_vnc_constraint_update;

            PRAGMA foreign_keys=on;

            ANALYZE; -- 重新分析数据库模式
        `,
  },
  {
    id: 6,
    name: 'Create passkeys table for WebAuthn credentials',
    check: async (db: Database): Promise<boolean> => {
      const passkeysTableAlreadyExists = await tableExists(db, 'passkeys');
      return !passkeysTableAlreadyExists;
    },
    sql: `
            CREATE TABLE IF NOT EXISTS passkeys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                credential_id TEXT UNIQUE NOT NULL, -- Base64URL encoded
                public_key TEXT NOT NULL, -- COSE public key, stored as Base64URL or HEX
                counter INTEGER NOT NULL,
                transports TEXT, -- JSON array of transports e.g. ["usb", "nfc", "ble", "internal"]
                name TEXT NULL, -- User-friendly name for the passkey
                backed_up BOOLEAN NOT NULL DEFAULT FALSE, -- Stored as 0 or 1
                last_used_at INTEGER NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        `,
  },
  {
    id: 7,
    name: 'Create path_history table',
    check: async (db: Database): Promise<boolean> => {
      const tableAlreadyExists = await tableExists(db, 'path_history');
      return !tableAlreadyExists;
    },
    sql: `
            CREATE TABLE IF NOT EXISTS path_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL,
                timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            );
        `,
  },
  {
    id: 8,
    name: 'Create favorite_paths table',
    check: async (db: Database): Promise<boolean> => {
      const tableAlreadyExists = await tableExists(db, 'favorite_paths');
      return !tableAlreadyExists; // Only run if the table does NOT exist
    },
    sql: `
            CREATE TABLE IF NOT EXISTS favorite_paths (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NULL,
                path TEXT NOT NULL,
                last_used_at INTEGER NULL;
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            );
        `,
  },
  {
    id: 9,
    name: 'Add jump_chain and proxy_type columns to connections table',
    sql: `
            ALTER TABLE connections ADD COLUMN jump_chain TEXT NULL;
            ALTER TABLE connections ADD COLUMN proxy_type TEXT NULL;
        `,
    check: async (db: Database): Promise<boolean> => {
      const jumpChainColumnExists = await columnExists(db, 'connections', 'jump_chain');
      const proxyTypeColumnExists = await columnExists(db, 'connections', 'proxy_type');
      return !jumpChainColumnExists || !proxyTypeColumnExists;
    },
  },
  {
    id: 10,
    name: 'Add variables column to quick_commands table',
    check: async (db: Database): Promise<boolean> => {
      const columnAlreadyExists = await columnExists(db, 'quick_commands', 'variables');
      return !columnAlreadyExists;
    },
    sql: `
            ALTER TABLE quick_commands ADD COLUMN variables TEXT NULL;
        `,
  },
  {
    id: 19,
    name: 'Add RDP options column to connections table',
    check: async (db: Database): Promise<boolean> => {
      const columnAlreadyExists = await columnExists(db, 'connections', 'rdp_options');
      return !columnAlreadyExists;
    },
    sql: `
            ALTER TABLE connections ADD COLUMN rdp_options TEXT NULL;
        `,
  },
  {
    id: 20,
    name: 'Normalize legacy proxy routes without proxy references',
    sql: `
            UPDATE connections
            SET proxy_type = NULL
            WHERE proxy_type = 'proxy'
              AND proxy_id IS NULL;
        `,
  },
];
