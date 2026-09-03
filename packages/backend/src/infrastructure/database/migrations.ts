import type { Database } from './connection';

// 1. 定义 migrations 表 SQL
const createMigrationsTableSQL = `
CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY, -- 迁移的版本号
    name TEXT NOT NULL,     -- 迁移的描述性名称
    applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')) -- 应用迁移的时间戳
);
`;

// 2. 定义迁移列表
// 注意：这里的迁移应该代表数据库模式从某个已知状态到下一个状态的变化。
// 初始模式通常在 database.ts 中通过 schema.registry.ts 创建。
// 这里的迁移应该从版本 1 开始，代表初始模式创建后的第一个变更。
interface Migration {
  id: number;
  name: string;
  sql: string; // 可以是多条 SQL 语句，用 ; 分隔。db.exec 会处理。
  check?: (db: Database) => Promise<boolean>; // 可选的前置检查函数
}

// 辅助函数：检查表是否存在
const tableExists = async (db: Database, tableName: string): Promise<boolean> => {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
  return Boolean(row);
};

// 辅助函数：检查列是否存在
const columnExists = async (db: Database, tableName: string, columnName: string): Promise<boolean> => {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
};

// 辅助函数：获取表的创建 SQL
const getTableCreateSQL = async (db: Database, tableName: string): Promise<string | null> => {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(tableName) as
    { sql?: string } | undefined;
  return row?.sql ?? null;
};

const definedMigrations: Migration[] = [
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
  // --- Quick Command Tags Migrations ---
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
        console.warn(
          '[Migrations] Check for VNC in connections.type: Could not parse CHECK constraint from SQL. Assuming migration is needed.',
        );
        return true;
      }
      console.warn(
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
  // Migration IDs 11-18 were used by historical releases. They may already
  // exist in long-lived databases even though those migrations have since
  // been folded into the current base schema. Never reuse those IDs.
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
];

/**
 * 运行数据库迁移。
 * 检查当前数据库版本，并按顺序应用所有新的迁移。
 * @param db 数据库实例
 */
export const runMigrations = async (db: Database): Promise<void> => {
  console.log('[Migrations] 开始检查和应用数据库迁移...');

  db.exec(createMigrationsTableSQL);
  console.log('[Migrations] migrations 表已确保存在。');

  const row = db.prepare('SELECT MAX(id) as currentVersion FROM migrations').get() as
    { currentVersion: number | null } | undefined;
  const currentVersion = row?.currentVersion ?? 0;
  console.log(`[Migrations] 当前数据库版本: ${currentVersion}`);

  const migrationsToApply = definedMigrations
    .filter((migration) => migration.id > currentVersion)
    .sort((a, b) => a.id - b.id);

  if (migrationsToApply.length === 0) {
    console.log('[Migrations] 数据库已是最新版本，无需迁移。');
    return;
  }

  console.log(
    `[Migrations] 发现 ${migrationsToApply.length} 个新迁移需要应用:`,
    migrationsToApply.map((migration) => `  #${migration.id}: ${migration.name}`),
  );

  const insertMigration = db.prepare(
    "INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, strftime('%s', 'now'))",
  );

  for (const migration of migrationsToApply) {
    console.log(`[Migrations] 应用迁移 #${migration.id}: ${migration.name}...`);
    db.exec('BEGIN TRANSACTION');

    try {
      let needsSqlExecution = true;
      if (migration.check) {
        console.log(`[Migrations] 执行迁移 #${migration.id} 的前置检查...`);
        needsSqlExecution = await migration.check(db);
        console.log(
          `[Migrations] 迁移 #${migration.id} 前置检查结果: ${needsSqlExecution ? '需要执行 SQL' : '跳过 SQL 执行'}`,
        );
      }

      if (needsSqlExecution) {
        console.log(`[Migrations] 执行迁移 #${migration.id} 的 SQL...`);
        try {
          db.exec(migration.sql);
        } catch (error: any) {
          if (error.message.includes('duplicate column name')) {
            console.warn(
              `[Migrations] 迁移 #${migration.id} SQL 执行时出现 'duplicate column name' 错误，视为可接受并继续。`,
            );
          } else {
            throw error;
          }
        }
      }

      console.log(`[Migrations] 记录迁移 #${migration.id} 到 migrations 表...`);
      insertMigration.run(migration.id, migration.name);
      db.exec('COMMIT');
      console.log(`[Migrations] 迁移 #${migration.id}: ${migration.name} 应用成功 (SQL 可能已跳过)。`);
    } catch (error: any) {
      console.error(`[Migrations] 迁移 #${migration.id} 步骤失败，正在回滚事务...`);
      try {
        db.exec('ROLLBACK');
      } catch (rollbackError) {
        console.error(`[Migrations] 回滚迁移 #${migration.id} 事务失败:`, rollbackError);
      }
      throw new Error(`迁移 #${migration.id} 失败: ${error.message}`);
    }
  }

  console.log('[Migrations] 所有新迁移已成功应用！');
};
