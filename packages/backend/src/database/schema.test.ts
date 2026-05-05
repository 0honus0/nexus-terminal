import { describe, it, expect } from 'vitest';
import {
  createUsersTableSQL,
  createConnectionsTableSQL,
  createSettingsTableSQL,
  createSshKeysTableSQL,
  createTagsTableSQL,
  createConnectionTagsTableSQL,
  createAuditLogsTableSQL,
  createCommandHistoryTableSQL,
  createPathHistoryTableSQL,
  createFavoritePathsTableSQL,
  createQuickCommandsTableSQL,
  createQuickCommandTagsTableSQL,
  createQuickCommandTagAssociationsTableSQL,
  createNotificationSettingsTableSQL,
  createIpBlacklistTableSQL,
  createTerminalThemesTableSQL,
  createAppearanceSettingsTableSQL,
  createProxiesTableSQL,
  createPasskeysTableSQL,
  createBatchTasksTableSQL,
  createBatchSubTasksTableSQL,
  createAISessionsTableSQL,
  createAIMessagesTableSQL,
  createIpGeoCacheTableSQL,
  createAuditLogsIndexesSQL,
  createBatchTasksIndexesSQL,
  createBatchSubTasksIndexesSQL,
  createAISessionsIndexesSQL,
  createAIMessagesIndexesSQL,
  createIpGeoCacheIndexesSQL,
} from './schema';

describe('database/schema', () => {
  describe('核心表 DDL', () => {
    const coreTableTests: Array<{ name: string; sql: string; table: string }> = [
      { name: 'users 表', sql: createUsersTableSQL, table: 'users' },
      { name: 'connections 表', sql: createConnectionsTableSQL, table: 'connections' },
      { name: 'settings 表', sql: createSettingsTableSQL, table: 'settings' },
      { name: 'ssh_keys 表', sql: createSshKeysTableSQL, table: 'ssh_keys' },
      { name: 'tags 表', sql: createTagsTableSQL, table: 'tags' },
      { name: 'connection_tags 表', sql: createConnectionTagsTableSQL, table: 'connection_tags' },
      { name: 'passkeys 表', sql: createPasskeysTableSQL, table: 'passkeys' },
      { name: 'proxies 表', sql: createProxiesTableSQL, table: 'proxies' },
    ];

    for (const t of coreTableTests) {
      it(`${t.name} 应包含 CREATE TABLE 语句`, () => {
        expect(t.sql).toContain('CREATE TABLE');
        expect(t.sql).toContain(t.table);
      });

      it(`${t.name} 应包含 IF NOT EXISTS`, () => {
        expect(t.sql).toContain('IF NOT EXISTS');
      });

      it(`${t.sql.length > 0 ? '非空' : '空'} — ${t.name} 应为非空字符串`, () => {
        expect(t.sql.length).toBeGreaterThan(0);
      });
    }
  });

  describe('功能表 DDL', () => {
    const featureTableTests: Array<{ name: string; sql: string; table: string }> = [
      { name: 'audit_logs 表', sql: createAuditLogsTableSQL, table: 'audit_logs' },
      { name: 'command_history 表', sql: createCommandHistoryTableSQL, table: 'command_history' },
      { name: 'path_history 表', sql: createPathHistoryTableSQL, table: 'path_history' },
      { name: 'favorite_paths 表', sql: createFavoritePathsTableSQL, table: 'favorite_paths' },
      { name: 'quick_commands 表', sql: createQuickCommandsTableSQL, table: 'quick_commands' },
      {
        name: 'quick_command_tags 表',
        sql: createQuickCommandTagsTableSQL,
        table: 'quick_command_tags',
      },
      {
        name: 'quick_command_tag_associations 表',
        sql: createQuickCommandTagAssociationsTableSQL,
        table: 'quick_command_tag_associations',
      },
      {
        name: 'notification_settings 表',
        sql: createNotificationSettingsTableSQL,
        table: 'notification_settings',
      },
      { name: 'ip_blacklist 表', sql: createIpBlacklistTableSQL, table: 'ip_blacklist' },
      { name: 'terminal_themes 表', sql: createTerminalThemesTableSQL, table: 'terminal_themes' },
      {
        name: 'appearance_settings 表',
        sql: createAppearanceSettingsTableSQL,
        table: 'appearance_settings',
      },
    ];

    for (const t of featureTableTests) {
      it(`${t.name} 应包含 CREATE TABLE 语句`, () => {
        expect(t.sql).toContain('CREATE TABLE');
        expect(t.sql).toContain(t.table);
      });
    }
  });

  describe('Phase 4/5 新增表 DDL', () => {
    it('batch_tasks 表应包含任务管理字段', () => {
      expect(createBatchTasksTableSQL).toContain('CREATE TABLE');
      expect(createBatchTasksTableSQL).toContain('batch_tasks');
      expect(createBatchTasksTableSQL).toContain('user_id');
    });

    it('batch_subtasks 表应包含子任务字段', () => {
      expect(createBatchSubTasksTableSQL).toContain('CREATE TABLE');
      expect(createBatchSubTasksTableSQL).toContain('batch_subtasks');
      expect(createBatchSubTasksTableSQL).toContain('task_id');
    });

    it('ai_sessions 表应包含会话管理字段', () => {
      expect(createAISessionsTableSQL).toContain('CREATE TABLE');
      expect(createAISessionsTableSQL).toContain('ai_sessions');
    });

    it('ai_messages 表应包含消息字段', () => {
      expect(createAIMessagesTableSQL).toContain('CREATE TABLE');
      expect(createAIMessagesTableSQL).toContain('ai_messages');
      expect(createAIMessagesTableSQL).toContain('session_id');
    });

    it('ip_geo_cache 表应包含地理定位缓存字段', () => {
      expect(createIpGeoCacheTableSQL).toContain('CREATE TABLE');
      expect(createIpGeoCacheTableSQL).toContain('ip_geo_cache');
    });
  });

  describe('索引 DDL', () => {
    const indexTests: Array<{ name: string; indexes: string[]; table: string }> = [
      { name: 'audit_logs', indexes: createAuditLogsIndexesSQL, table: 'audit_logs' },
      { name: 'batch_tasks', indexes: createBatchTasksIndexesSQL, table: 'batch_tasks' },
      { name: 'batch_subtasks', indexes: createBatchSubTasksIndexesSQL, table: 'batch_subtasks' },
      { name: 'ai_sessions', indexes: createAISessionsIndexesSQL, table: 'ai_sessions' },
      { name: 'ai_messages', indexes: createAIMessagesIndexesSQL, table: 'ai_messages' },
      { name: 'ip_geo_cache', indexes: createIpGeoCacheIndexesSQL, table: 'ip_geo_cache' },
    ];

    for (const t of indexTests) {
      it(`${t.name} 应定义索引`, () => {
        expect(t.indexes).toBeDefined();
        expect(Array.isArray(t.indexes)).toBe(true);
        expect(t.indexes.length).toBeGreaterThan(0);
      });

      it(`${t.name} 索引应包含 CREATE INDEX 语句`, () => {
        for (const idx of t.indexes) {
          expect(idx).toContain('CREATE');
          expect(idx).toContain('INDEX');
        }
      });
    }
  });

  describe('关键字段完整性', () => {
    it('users 表应包含 username 和 hashed_password', () => {
      expect(createUsersTableSQL).toContain('username');
      expect(createUsersTableSQL).toContain('hashed_password');
    });

    it('connections 表应包含 SSH 连接核心字段', () => {
      expect(createConnectionsTableSQL).toContain('host');
      expect(createConnectionsTableSQL).toContain('port');
      expect(createConnectionsTableSQL).toContain('auth_method');
    });

    it('audit_logs 表应包含审计核心字段', () => {
      expect(createAuditLogsTableSQL).toContain('action');
      expect(createAuditLogsTableSQL).toContain('user_id');
    });

    it('passkeys 表应包含 WebAuthn 核心字段', () => {
      expect(createPasskeysTableSQL).toContain('credential_id');
      expect(createPasskeysTableSQL).toContain('public_key');
    });

    it('ip_geo_cache 表应包含 IP 和地理定位字段', () => {
      expect(createIpGeoCacheTableSQL).toContain('ip');
    });
  });
});
