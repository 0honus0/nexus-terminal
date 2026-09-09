import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import type { BackupSnapshotPort } from '../../modules/backup/backup.port';
import type { BackupFileEntry, BackupSnapshot } from '../../modules/backup/backup.types';
import type { RelationalDatabase } from '../../platform/storage/relational-database.port';
import type { SecretCipher } from '../../shared/security/crypto.port';

const TABLES = [
  'settings',
  'settings_migrations',
  'notification_settings',
  'proxies',
  'ssh_keys',
  'connections',
  'tags',
  'connection_tags',
  'command_history',
  'path_history',
  'quick_commands',
  'quick_command_tags',
  'quick_command_tag_associations',
  'terminal_themes',
  'appearance_settings',
  'favorite_paths',
] as const;
const FILE_DIRECTORIES = ['background', 'custom_html_theme'] as const;
const SENSITIVE_COLUMNS: Record<string, readonly string[]> = {
  proxies: ['encrypted_password', 'encrypted_private_key', 'encrypted_passphrase'],
  ssh_keys: ['encrypted_private_key', 'encrypted_passphrase'],
  connections: ['encrypted_password', 'encrypted_private_key', 'encrypted_passphrase'],
};

interface RestoreSwap {
  directory: string;
  target: string;
  previous: string;
  hadPrevious: boolean;
}

const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`;

/** Captures/restores the Nexus product data set. Raw SQL/file layout never escapes this adapter. */
export class SqliteBackupSnapshotAdapter implements BackupSnapshotPort {
  constructor(
    private readonly database: RelationalDatabase,
    private readonly cipher: SecretCipher,
    private readonly dataDirectory: string,
  ) {}

  async capture(): Promise<BackupSnapshot> {
    const tables: Record<string, Record<string, unknown>[]> = {};
    for (const table of TABLES) tables[table] = await this.captureTable(table);
    const files: BackupFileEntry[] = [];
    for (const directory of FILE_DIRECTORIES) await this.collectFiles(directory, files);
    return { format: 'nexus-terminal-backup', version: 1, createdAt: new Date().toISOString(), tables, files };
  }

  async restore(
    snapshot: BackupSnapshot,
  ): Promise<{ restoredTables: number; restoredRows: number; restoredFiles: number }> {
    this.validateSnapshot(snapshot);
    const stagingRoot = path.join(this.dataDirectory, `.backup-restore-${randomUUID()}`);
    const previousRoot = path.join(this.dataDirectory, `.backup-previous-${randomUUID()}`);
    await mkdir(stagingRoot, { recursive: true });
    await mkdir(previousRoot, { recursive: true });
    try {
      await this.stageFiles(snapshot.files, stagingRoot);
      const swaps = await this.swapStagedDirectories(stagingRoot, previousRoot);
      try {
        const databaseResult = await this.restoreTables(snapshot.tables);
        await rm(previousRoot, { recursive: true, force: true });
        await rm(stagingRoot, { recursive: true, force: true });
        return { ...databaseResult, restoredFiles: snapshot.files.length };
      } catch (error) {
        await this.rollbackSwaps(swaps);
        throw error;
      }
    } finally {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      await rm(previousRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async captureTable(table: string): Promise<Record<string, unknown>[]> {
    if (!(await this.tableExists(this.database, table))) return [];
    const rows = await this.database.queryAll<Record<string, unknown>>(`SELECT * FROM ${quoteIdentifier(table)}`);
    const sensitive = SENSITIVE_COLUMNS[table] ?? [];
    if (!sensitive.length) return rows;
    return rows.map((source) => {
      const row = { ...source };
      const plaintext: Record<string, string | null> = {};
      for (const column of sensitive) {
        const encrypted = row[column];
        plaintext[column] = typeof encrypted === 'string' && encrypted ? this.cipher.decrypt(encrypted) : null;
        row[column] = null;
      }
      row.__backup_plaintext = plaintext;
      return row;
    });
  }

  private async collectFiles(directory: string, output: BackupFileEntry[]): Promise<void> {
    const root = path.join(this.dataDirectory, directory);
    let entries: Dirent[];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    const walk = async (current: string): Promise<void> => {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) await walk(absolute);
        else if (entry.isFile())
          output.push({
            path: path.relative(this.dataDirectory, absolute).split(path.sep).join('/'),
            contentBase64: (await readFile(absolute)).toString('base64'),
          });
      }
    };
    void entries;
    await walk(root);
  }

  private validateSnapshot(snapshot: BackupSnapshot): void {
    if (snapshot.format !== 'nexus-terminal-backup' || snapshot.version !== 1)
      throw new Error('备份载荷版本不受支持。');
    if (!snapshot.tables || typeof snapshot.tables !== 'object' || Array.isArray(snapshot.tables))
      throw new Error('备份表数据无效。');
    if (!Array.isArray(snapshot.files)) throw new Error('备份文件数据无效。');
    for (const table of Object.keys(snapshot.tables))
      if (!TABLES.includes(table as (typeof TABLES)[number])) throw new Error(`备份包含不允许的数据表: ${table}`);
    for (const file of snapshot.files) {
      if (!file || typeof file.path !== 'string' || typeof file.contentBase64 !== 'string')
        throw new Error('备份包含无效的文件条目。');
      this.safeRelativeFilePath(file.path);
    }
  }

  private safeRelativeFilePath(value: string): string {
    const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!FILE_DIRECTORIES.some((directory) => normalized.startsWith(`${directory}/`)))
      throw new Error(`备份包含不允许的文件路径: ${value}`);
    const resolved = path.resolve(this.dataDirectory, normalized);
    const root = path.resolve(this.dataDirectory) + path.sep;
    if (!resolved.startsWith(root)) throw new Error(`备份包含不安全的文件路径: ${value}`);
    return normalized;
  }

  private async stageFiles(files: readonly BackupFileEntry[], stagingRoot: string): Promise<void> {
    for (const directory of FILE_DIRECTORIES) await mkdir(path.join(stagingRoot, directory), { recursive: true });
    for (const file of files) {
      const relative = this.safeRelativeFilePath(file.path);
      const target = path.join(stagingRoot, ...relative.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(file.contentBase64, 'base64'));
    }
  }

  private async swapStagedDirectories(stagingRoot: string, previousRoot: string): Promise<RestoreSwap[]> {
    const swaps: RestoreSwap[] = [];
    try {
      for (const directory of FILE_DIRECTORIES) {
        const target = path.join(this.dataDirectory, directory);
        const staged = path.join(stagingRoot, directory);
        const previous = path.join(previousRoot, directory);
        const hadPrevious = await this.exists(target);
        if (hadPrevious) await rename(target, previous);
        await rename(staged, target);
        swaps.push({ directory, target, previous, hadPrevious });
      }
      return swaps;
    } catch (error) {
      await this.rollbackSwaps(swaps);
      throw error;
    }
  }

  private async rollbackSwaps(swaps: readonly RestoreSwap[]): Promise<void> {
    for (const swap of [...swaps].reverse()) {
      await rm(swap.target, { recursive: true, force: true }).catch(() => undefined);
      if (swap.hadPrevious) await rename(swap.previous, swap.target).catch(() => undefined);
    }
  }

  private async restoreTables(
    tables: Record<string, Record<string, unknown>[]>,
  ): Promise<{ restoredTables: number; restoredRows: number }> {
    return this.database.transaction(async (database) => {
      let restoredTables = 0,
        restoredRows = 0;
      for (const table of [...TABLES].reverse())
        if (await this.tableExists(database, table)) await database.execute(`DELETE FROM ${quoteIdentifier(table)}`);
      for (const table of TABLES) {
        if (!(await this.tableExists(database, table))) continue;
        const columns = new Set(
          (await database.queryAll<{ name: string }>(`PRAGMA table_info(${quoteIdentifier(table)})`)).map(
            (item) => item.name,
          ),
        );
        const rows = Array.isArray(tables[table]) ? tables[table] : [];
        for (const source of rows) {
          const row = this.prepareRow(table, source);
          const names = Object.keys(row).filter((name) => columns.has(name));
          if (!names.length) continue;
          await database.execute(
            `INSERT INTO ${quoteIdentifier(table)} (${names.map(quoteIdentifier).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
            names.map((name) => row[name]),
          );
          restoredRows += 1;
        }
        restoredTables += 1;
      }
      return { restoredTables, restoredRows };
    });
  }

  private prepareRow(table: string, source: Record<string, unknown>): Record<string, unknown> {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error(`备份表 ${table} 包含无效行。`);
    const row = { ...source };
    const plaintext = row.__backup_plaintext;
    delete row.__backup_plaintext;
    if (plaintext && typeof plaintext === 'object' && !Array.isArray(plaintext)) {
      for (const column of SENSITIVE_COLUMNS[table] ?? []) {
        const value = (plaintext as Record<string, unknown>)[column];
        row[column] = typeof value === 'string' && value ? this.cipher.encrypt(value) : null;
      }
    }
    return row;
  }

  private async tableExists(database: RelationalDatabase, table: string): Promise<boolean> {
    return Boolean(
      await database.queryOne<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [
        table,
      ]),
    );
  }

  private async exists(target: string): Promise<boolean> {
    try {
      await stat(target);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
}
