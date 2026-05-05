import { describe, expect, it, vi, beforeEach } from 'vitest';
import { validateBackup, importData } from './backup.service';
import { BACKUP_FORMAT_VERSION } from './backup.types';
import { getDbInstance, runDb } from '../database/connection';

vi.mock('../database/connection', () => ({
  getDbInstance: vi.fn(),
  allDb: vi.fn(),
  runDb: vi.fn(),
}));

const mockDb = {} as never;

describe('backup.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDbInstance).mockResolvedValue(mockDb);
  });

  describe('validateBackup', () => {
    it('空数据应返回无效', () => {
      const result = validateBackup(null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('无效的备份数据格式');
    });

    it('缺少 metadata 应返回无效', () => {
      const result = validateBackup({ connections: [] });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('缺少备份元信息');
    });

    it('版本过高应返回无效', () => {
      const result = validateBackup({
        metadata: { version: BACKUP_FORMAT_VERSION + 1, exportedAt: 1 },
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('高于当前支持的版本');
    });

    it('合法备份数据应返回有效', () => {
      const result = validateBackup({
        metadata: { version: BACKUP_FORMAT_VERSION, exportedAt: 1, recordCounts: {} },
      });
      expect(result.valid).toBe(true);
      expect(result.metadata).toBeDefined();
    });
  });

  describe('importData', () => {
    it('空数据应返回全零结果', async () => {
      const payload = {
        metadata: { version: BACKUP_FORMAT_VERSION, exportedAt: 1, recordCounts: {} },
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

      const result = await importData(payload);
      expect(result.errors).toHaveLength(0);
      expect(Object.values(result.imported).every((v) => v === 0)).toBe(true);
    });

    it('指定 tables 选项时仅导入指定表', async () => {
      vi.mocked(runDb).mockResolvedValue({ lastID: 1, changes: 1 });

      const payload = {
        metadata: { version: BACKUP_FORMAT_VERSION, exportedAt: 1, recordCounts: {} },
        connections: [
          {
            name: 'test',
            type: 'SSH',
            host: '1.2.3.4',
            port: 22,
            username: 'root',
            auth_method: 'password',
          },
        ],
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

      const result = await importData(payload, { tables: ['connections'] });
      expect(result.imported.connections).toBe(1);
      expect(result.imported.sshKeys).toBeUndefined();
      expect(result.errors).toHaveLength(0);
    });
  });
});
