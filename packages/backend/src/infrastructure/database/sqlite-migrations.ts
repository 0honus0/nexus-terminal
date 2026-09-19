import type { DatabaseSync as Database } from 'node:sqlite';
import { logger } from '../../shared/logging/logger';
import {
  createAgentInputRequestsTableSQL,
  createAiContextCheckpointsTableSQL,
  createAiMemorySearchIndexSQL,
  createAiThreadEntrySearchIndexSQL,
} from './sqlite-schema';

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
  {
    id: 21,
    name: 'Track Agent thread title ownership',
    check: async (db: Database): Promise<boolean> => {
      const columnAlreadyExists = await columnExists(db, 'ai_threads', 'title_source');
      return !columnAlreadyExists;
    },
    sql: `
            ALTER TABLE ai_threads ADD COLUMN title_source TEXT NOT NULL DEFAULT 'manual'
              CHECK(title_source IN ('placeholder','auto','manual'));
            UPDATE ai_threads
            SET title_source = 'placeholder'
            WHERE title = 'New conversation'
              AND NOT EXISTS (
                SELECT 1 FROM ai_thread_entries e WHERE e.thread_id = ai_threads.id
              );
        `,
  },
  {
    id: 22,
    name: 'Use the current Agent tool risk enum in durable tool state',
    check: async (db: Database): Promise<boolean> => {
      const createSQL = await getTableCreateSQL(db, 'agent_tool_calls');
      if (!createSQL) return false;
      return !createSQL.includes("'control'") || !createSQL.includes("'forbidden'");
    },
    sql: `
            ALTER TABLE agent_approvals RENAME TO agent_approvals_old_risk_enum;
            ALTER TABLE agent_resource_quarantine RENAME TO agent_resource_quarantine_old_risk_enum;
            ALTER TABLE agent_tool_calls RENAME TO agent_tool_calls_old_risk_enum;

            CREATE TABLE agent_tool_calls (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                agent_runtime_id TEXT NOT NULL,
                step_id TEXT NOT NULL,
                provider_call_id TEXT NOT NULL,
                tool_name TEXT NOT NULL,
                tool_version TEXT NOT NULL,
                inspection_json TEXT NOT NULL CHECK(json_valid(inspection_json)),
                operation_hash TEXT NOT NULL,
                operation_hash_version INTEGER NOT NULL CHECK(operation_hash_version = 1),
                risk TEXT NOT NULL CHECK(risk IN ('read','control','mutate','destructive','forbidden')),
                status TEXT NOT NULL CHECK(status IN (
                  'proposed','awaiting_approval','ready','running','succeeded','verification_failed','failed','cancelled','reconciling'
                )),
                result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
                created_at INTEGER NOT NULL,
                started_at INTEGER,
                completed_at INTEGER,
                version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
                UNIQUE(step_id, provider_call_id),
                UNIQUE(step_id, operation_hash),
                UNIQUE(id, run_id),
                FOREIGN KEY(step_id, run_id) REFERENCES agent_steps(id, run_id) ON DELETE CASCADE,
                FOREIGN KEY(agent_runtime_id, run_id) REFERENCES agent_runtimes(id, run_id) ON DELETE CASCADE
            );

            INSERT INTO agent_tool_calls (
              id, run_id, agent_runtime_id, step_id, provider_call_id, tool_name, tool_version,
              inspection_json, operation_hash, operation_hash_version, risk, status, result_json,
              created_at, started_at, completed_at, version
            )
            SELECT
              id, run_id, agent_runtime_id, step_id, provider_call_id, tool_name, tool_version,
              inspection_json, operation_hash, operation_hash_version, risk, status, result_json,
              created_at, started_at, completed_at, version
            FROM agent_tool_calls_old_risk_enum;

            CREATE TABLE agent_approvals (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                app_id TEXT NOT NULL,
                run_id TEXT NOT NULL,
                tool_call_id TEXT NOT NULL,
                requested_by_runtime_id TEXT NOT NULL,
                operation_hash TEXT NOT NULL,
                operation_hash_version INTEGER NOT NULL CHECK(operation_hash_version = 1),
                status TEXT NOT NULL CHECK(status IN ('requested','approved','denied','expired','superseded')),
                policy_revision INTEGER NOT NULL CHECK(policy_revision > 0),
                input_revision INTEGER NOT NULL CHECK(input_revision >= 0),
                decided_by_user_id INTEGER REFERENCES users(id),
                decided_at INTEGER,
                consumed_at INTEGER,
                requested_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
                FOREIGN KEY(run_id, user_id, app_id) REFERENCES agent_runs(id, user_id, app_id) ON DELETE CASCADE,
                FOREIGN KEY(tool_call_id, run_id) REFERENCES agent_tool_calls(id, run_id) ON DELETE CASCADE,
                FOREIGN KEY(requested_by_runtime_id, run_id) REFERENCES agent_runtimes(id, run_id) ON DELETE CASCADE
            );

            INSERT INTO agent_approvals (
              id, user_id, app_id, run_id, tool_call_id, requested_by_runtime_id, operation_hash,
              operation_hash_version, status, policy_revision, input_revision, decided_by_user_id,
              decided_at, consumed_at, requested_at, expires_at, version
            )
            SELECT
              id, user_id, app_id, run_id, tool_call_id, requested_by_runtime_id, operation_hash,
              operation_hash_version, status, policy_revision, input_revision, decided_by_user_id,
              decided_at, consumed_at, requested_at, expires_at, version
            FROM agent_approvals_old_risk_enum;

            CREATE TABLE agent_resource_quarantine (
                resource_key TEXT PRIMARY KEY REFERENCES agent_resource_fences(resource_key) ON DELETE CASCADE,
                tool_call_id TEXT REFERENCES agent_tool_calls(id) ON DELETE SET NULL,
                owner_type TEXT NOT NULL CHECK(owner_type IN ('agent','workspace','system')),
                owner_id TEXT NOT NULL,
                reason TEXT NOT NULL,
                evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
                version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
                created_at INTEGER NOT NULL
            );

            INSERT INTO agent_resource_quarantine (
              resource_key, tool_call_id, owner_type, owner_id, reason, evidence_json, version, created_at
            )
            SELECT resource_key, tool_call_id, owner_type, owner_id, reason, evidence_json, version, created_at
            FROM agent_resource_quarantine_old_risk_enum;

            DROP TABLE agent_approvals_old_risk_enum;
            DROP TABLE agent_resource_quarantine_old_risk_enum;
            DROP TABLE agent_tool_calls_old_risk_enum;

            CREATE UNIQUE INDEX agent_one_active_approval ON agent_approvals(tool_call_id)
                WHERE status = 'requested' OR (status = 'approved' AND consumed_at IS NULL);
            CREATE INDEX agent_approval_expiry ON agent_approvals(status, expires_at);
            CREATE INDEX agent_approval_scope ON agent_approvals(user_id, app_id, run_id, requested_at);
        `,
  },
  {
    id: 23,
    name: 'Track durable Agent tool-call batch lineage',
    check: async (db: Database): Promise<boolean> => {
      const tableAlreadyExists = await tableExists(db, 'agent_tool_calls');
      if (!tableAlreadyExists) return false;
      return !(await columnExists(db, 'agent_tool_calls', 'source_model_step_id'));
    },
    sql: `
            ALTER TABLE agent_tool_calls
              ADD COLUMN source_model_step_id TEXT REFERENCES agent_steps(id);
            ALTER TABLE agent_tool_calls
              ADD COLUMN batch_index INTEGER NOT NULL DEFAULT 0 CHECK(batch_index >= 0);
            ALTER TABLE agent_tool_calls
              ADD COLUMN batch_size INTEGER NOT NULL DEFAULT 1 CHECK(batch_size >= 1);
            CREATE INDEX IF NOT EXISTS agent_tool_call_batch_lineage
              ON agent_tool_calls(run_id, agent_runtime_id, source_model_step_id, batch_index);
        `,
  },
  {
    id: 24,
    name: 'Enforce Agent tool-call source model step run lineage on upgraded databases',
    sql: `
            CREATE TRIGGER IF NOT EXISTS agent_tool_call_source_model_run_insert
            BEFORE INSERT ON agent_tool_calls
            WHEN NEW.source_model_step_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM agent_steps
                WHERE id = NEW.source_model_step_id AND run_id = NEW.run_id
              )
            BEGIN
              SELECT RAISE(ABORT, 'agent_tool_call_source_model_run_mismatch');
            END;

            CREATE TRIGGER IF NOT EXISTS agent_tool_call_source_model_run_update
            BEFORE UPDATE OF source_model_step_id, run_id ON agent_tool_calls
            WHEN NEW.source_model_step_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM agent_steps
                WHERE id = NEW.source_model_step_id AND run_id = NEW.run_id
              )
            BEGIN
              SELECT RAISE(ABORT, 'agent_tool_call_source_model_run_mismatch');
            END;
        `,
  },
  {
    id: 25,
    name: 'Normalize Agent tool-call batch lineage and require model-step ownership',
    sql: `
            -- Migration #23 could only add a nullable lineage column to already-populated
            -- databases. Recover the canonical source model step from the durable step order:
            -- a Tool step belongs to the nearest preceding Model step in the same Runtime.
            UPDATE agent_tool_calls AS target
            SET source_model_step_id = (
              SELECT model_step.id
              FROM agent_steps AS tool_step
              JOIN agent_steps AS model_step
                ON model_step.run_id = target.run_id
               AND model_step.agent_runtime_id = target.agent_runtime_id
               AND model_step.kind = 'model'
               AND model_step.step_index < tool_step.step_index
              WHERE tool_step.id = target.step_id
                AND tool_step.run_id = target.run_id
              ORDER BY model_step.step_index DESC
              LIMIT 1
            )
            WHERE target.source_model_step_id IS NULL;

            -- Batch metadata added by #23 defaulted to 0/1 for historical rows. Recompute it
            -- from canonical Tool-step ordering for every source model step so upgraded and
            -- freshly-created databases expose the same projection.
            UPDATE agent_tool_calls AS target
            SET batch_index = (
                  SELECT COUNT(*)
                  FROM agent_tool_calls AS sibling
                  JOIN agent_steps AS sibling_step
                    ON sibling_step.id = sibling.step_id AND sibling_step.run_id = sibling.run_id
                  JOIN agent_steps AS target_step
                    ON target_step.id = target.step_id AND target_step.run_id = target.run_id
                  WHERE sibling.run_id = target.run_id
                    AND sibling.agent_runtime_id = target.agent_runtime_id
                    AND sibling.source_model_step_id = target.source_model_step_id
                    AND (
                      sibling_step.step_index < target_step.step_index OR
                      (sibling_step.step_index = target_step.step_index AND sibling.id < target.id)
                    )
                ),
                batch_size = (
                  SELECT COUNT(*)
                  FROM agent_tool_calls AS sibling
                  WHERE sibling.run_id = target.run_id
                    AND sibling.agent_runtime_id = target.agent_runtime_id
                    AND sibling.source_model_step_id = target.source_model_step_id
                )
            WHERE target.source_model_step_id IS NOT NULL;

            -- Fail the migration instead of preserving a runtime fallback if any durable Tool
            -- row cannot be mapped to a real Model step in the same Run/Runtime.
            CREATE TEMP TABLE agent_tool_lineage_migration_guard (
              invalid_count INTEGER NOT NULL CHECK(invalid_count = 0)
            );
            INSERT INTO agent_tool_lineage_migration_guard(invalid_count)
            SELECT COUNT(*)
            FROM agent_tool_calls AS target
            WHERE target.source_model_step_id IS NULL
               OR NOT EXISTS (
                    SELECT 1 FROM agent_steps AS model_step
                    WHERE model_step.id = target.source_model_step_id
                      AND model_step.run_id = target.run_id
                      AND model_step.agent_runtime_id = target.agent_runtime_id
                      AND model_step.kind = 'model'
                  );
            DROP TABLE agent_tool_lineage_migration_guard;

            DROP TRIGGER IF EXISTS agent_tool_call_source_model_run_insert;
            DROP TRIGGER IF EXISTS agent_tool_call_source_model_run_update;

            CREATE TRIGGER IF NOT EXISTS agent_tool_call_source_model_invariant_insert
            BEFORE INSERT ON agent_tool_calls
            WHEN NEW.source_model_step_id IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM agent_steps
                WHERE id = NEW.source_model_step_id
                  AND run_id = NEW.run_id
                  AND agent_runtime_id = NEW.agent_runtime_id
                  AND kind = 'model'
              )
            BEGIN
              SELECT RAISE(ABORT, 'agent_tool_call_source_model_invalid');
            END;

            CREATE TRIGGER IF NOT EXISTS agent_tool_call_source_model_invariant_update
            BEFORE UPDATE OF source_model_step_id, run_id, agent_runtime_id ON agent_tool_calls
            WHEN NEW.source_model_step_id IS NULL
              OR NOT EXISTS (
                SELECT 1 FROM agent_steps
                WHERE id = NEW.source_model_step_id
                  AND run_id = NEW.run_id
                  AND agent_runtime_id = NEW.agent_runtime_id
                  AND kind = 'model'
              )
            BEGIN
              SELECT RAISE(ABORT, 'agent_tool_call_source_model_invalid');
            END;
        `,
  },
  {
    id: 26,
    name: 'Add durable Agent user-input clarification requests',
    check: async (db: Database): Promise<boolean> => !(await tableExists(db, 'agent_input_requests')),
    sql: createAgentInputRequestsTableSQL,
  },
  {
    id: 27,
    name: 'Add durable model provider continuation state',
    check: async (db: Database): Promise<boolean> =>
      (await tableExists(db, 'agent_model_attempts')) &&
      !(await columnExists(db, 'agent_model_attempts', 'continuation_json')),
    sql: `
            ALTER TABLE agent_model_attempts
              ADD COLUMN continuation_json TEXT
              CHECK(continuation_json IS NULL OR json_valid(continuation_json));
        `,
  },
  {
    id: 28,
    name: 'Add rebuildable indexed Agent recall projections',
    check: async (db: Database): Promise<boolean> =>
      (await tableExists(db, 'ai_memories')) && (await tableExists(db, 'ai_thread_entries')),
    sql: `
            ${createAiThreadEntrySearchIndexSQL}
            ${createAiMemorySearchIndexSQL}
            DELETE FROM ai_memories_search;
            INSERT INTO ai_memories_search(rowid, terms)
            SELECT rowid, nexus_search_terms(content) FROM ai_memories;
            DELETE FROM ai_thread_entries_search;
            INSERT INTO ai_thread_entries_search(rowid, terms)
            SELECT rowid, nexus_ledger_search_terms(payload_json) FROM ai_thread_entries;
        `,
  },
  {
    id: 29,
    name: 'Add Provider live capability observations',
    check: async (db: Database): Promise<boolean> =>
      (await tableExists(db, 'ai_providers')) && !(await columnExists(db, 'ai_providers', 'live_capabilities_json')),
    sql: `
            ALTER TABLE ai_providers
              ADD COLUMN live_capabilities_json TEXT NOT NULL DEFAULT '[]'
              CHECK(json_valid(live_capabilities_json));
        `,
  },
  {
    id: 30,
    name: 'Replace dead Context digests with durable Context checkpoints',
    check: async (db: Database): Promise<boolean> =>
      (await tableExists(db, 'ai_context_digests')) || !(await tableExists(db, 'ai_context_checkpoints')),
    sql: `
            DROP TABLE IF EXISTS ai_context_digests;
            ${createAiContextCheckpointsTableSQL}
        `,
  },
  {
    id: 31,
    name: 'Distinguish rolling Agent recovery checkpoints',
    check: async (db: Database): Promise<boolean> =>
      (await tableExists(db, 'agent_checkpoints')) && !(await columnExists(db, 'agent_checkpoints', 'kind')),
    sql: `
            ALTER TABLE agent_checkpoints
              ADD COLUMN kind TEXT NOT NULL DEFAULT 'user'
              CHECK(kind IN ('user','recovery'));
            CREATE UNIQUE INDEX IF NOT EXISTS agent_one_recovery_checkpoint_per_run
              ON agent_checkpoints(run_id) WHERE kind = 'recovery';
        `,
  },
  {
    id: 32,
    name: 'Freeze Subagent mutation governance mode on delegations',
    check: async (db: Database): Promise<boolean> =>
      (await tableExists(db, 'agent_delegations')) && !(await columnExists(db, 'agent_delegations', 'mutation_mode')),
    sql: `
            ALTER TABLE agent_delegations
              ADD COLUMN mutation_mode TEXT NOT NULL DEFAULT 'read-only'
              CHECK(mutation_mode IN ('read-only','governed'));
        `,
  },
];

/**
 * 运行数据库迁移。
 * 检查当前数据库版本，并按顺序应用所有新的迁移。
 * @param db 数据库实例
 */
export const runMigrations = async (db: Database): Promise<void> => {
  logger.info('[Migrations] 开始检查和应用数据库迁移...');

  db.exec(createMigrationsTableSQL);
  logger.info('[Migrations] migrations 表已确保存在。');

  const row = db.prepare('SELECT MAX(id) as currentVersion FROM migrations').get() as
    { currentVersion: number | null } | undefined;
  const currentVersion = row?.currentVersion ?? 0;
  logger.info(`[Migrations] 当前数据库版本: ${currentVersion}`);

  const migrationsToApply = definedMigrations
    .filter((migration) => migration.id > currentVersion)
    .sort((a, b) => a.id - b.id);

  if (migrationsToApply.length === 0) {
    logger.info('[Migrations] 数据库已是最新版本，无需迁移。');
    return;
  }

  logger.info(
    { migrations: migrationsToApply.map((migration) => ({ id: migration.id, name: migration.name })) },
    `Found ${migrationsToApply.length} database migration(s) to apply`,
  );

  const insertMigration = db.prepare(
    "INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, strftime('%s', 'now'))",
  );

  for (const migration of migrationsToApply) {
    logger.info(`[Migrations] 应用迁移 #${migration.id}: ${migration.name}...`);
    db.exec('BEGIN TRANSACTION');

    try {
      let needsSqlExecution = true;
      if (migration.check) {
        logger.info(`[Migrations] 执行迁移 #${migration.id} 的前置检查...`);
        needsSqlExecution = await migration.check(db);
        logger.info(
          `[Migrations] 迁移 #${migration.id} 前置检查结果: ${needsSqlExecution ? '需要执行 SQL' : '跳过 SQL 执行'}`,
        );
      }

      if (needsSqlExecution) {
        logger.info(`[Migrations] 执行迁移 #${migration.id} 的 SQL...`);
        try {
          db.exec(migration.sql);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes('duplicate column name')) {
            logger.warn(
              `[Migrations] 迁移 #${migration.id} SQL 执行时出现 'duplicate column name' 错误，视为可接受并继续。`,
            );
          } else {
            throw error;
          }
        }
      }

      logger.info(`[Migrations] 记录迁移 #${migration.id} 到 migrations 表...`);
      insertMigration.run(migration.id, migration.name);
      db.exec('COMMIT');
      logger.info(`[Migrations] 迁移 #${migration.id}: ${migration.name} 应用成功 (SQL 可能已跳过)。`);
    } catch (error) {
      logger.error(`[Migrations] 迁移 #${migration.id} 步骤失败，正在回滚事务...`);
      try {
        db.exec('ROLLBACK');
      } catch (rollbackError) {
        logger.error({ err: rollbackError, migrationId: migration.id }, 'Failed to roll back database migration');
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`迁移 #${migration.id} 失败: ${message}`);
    }
  }

  logger.info('[Migrations] 所有新迁移已成功应用！');
};
