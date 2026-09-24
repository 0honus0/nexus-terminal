import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import type { BackupSnapshotPort } from '../../modules/backup/backup.port';
import type { BackupFileEntry, BackupSnapshot } from '../../modules/backup/backup.types';
import type { RelationalDatabase } from '../../platform/storage/relational-database.port';
import type { SecretCipher } from '../../shared/security/crypto.port';

const PRODUCT_TABLES = [
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

// Keep this list in FK-safe creation order. Restore deletes it in reverse and inserts it forward.
// User identity/auth tables intentionally remain outside full backup ownership; Agent rows restore
// against the already-authenticated local Nexus user.
const AGENT_TABLES = [
  'agent_apps',
  'agent_app_grants',
  'agent_app_storage',
  'agent_settings',
  'agent_hard_limit_confirmations',
  'agent_target_denylist',
  'agent_target_denylist_meta',
  'ai_providers',
  'ai_artifacts',
  'agent_quota_usage',
  'ai_threads',
  'agent_runs',
  'agent_loop_guards',
  'ai_thread_entries',
  'agent_artifact_links',
  'agent_artifact_grants',
  'agent_artifact_cleanup_confirmations',
  'ai_context_checkpoints',
  'ai_memories',
  'agent_runtimes',
  'agent_steps',
  'agent_model_attempts',
  'agent_tool_calls',
  'agent_input_requests',
  'agent_events',
  'agent_host_cursors',
  'agent_host_events',
  'agent_commands',
  'agent_checkpoints',
  'agent_approvals',
  'agent_resource_fences',
  'agent_leases',
  'agent_resource_quarantine',
  'agent_integrations',
  'agent_delegations',
  'agent_mailbox_cursors',
  'agent_messages',
  'agent_scheduler_work',
  'agent_delegation_edges',
  'agent_shared_facts',
  'agent_publisher_keys',
  'agent_plugin_stages',
  'agent_plugin_pending_upgrades',
  'agent_plugin_versions',
  'agent_plugin_installations',
  'agent_app_intent_receipts',
  'agent_app_intent_artifact_grants',
  'agent_memory_import_confirmations',
  'agent_workspaces',
  'agent_workspace_runtime_commands',
  'agent_workspace_runtime_confirmations',
] as const;

const TABLES = [...PRODUCT_TABLES, ...AGENT_TABLES] as const;

// Only authoritative file-backed product state belongs here. In particular,
// agent/model-capability-registry.json is a rebuildable cache and is deliberately excluded.
const FILE_DIRECTORIES = ['background', 'custom_html_theme', 'agent/artifacts/objects', 'agent/plugins'] as const;
const SENSITIVE_COLUMNS: Record<string, readonly string[]> = {
  proxies: ['encrypted_password', 'encrypted_private_key', 'encrypted_passphrase'],
  ssh_keys: ['encrypted_private_key', 'encrypted_passphrase'],
  connections: ['encrypted_password', 'encrypted_private_key', 'encrypted_passphrase'],
  ai_providers: ['protected_credential'],
  agent_integrations: ['protected_credential'],
};

const FILE_SNAPSHOT_ATTEMPTS = 3;

interface BackupFileInventoryEntry {
  absolutePath: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
}

type RestoreSwapState = 'pending' | 'moving_original' | 'installing' | 'swapped';

interface RestoreSwap {
  directory: string;
  hadPrevious: boolean;
  state: RestoreSwapState;
}

interface RestoreJournal {
  version: 1;
  restoreId: string;
  stagingDirectory: string;
  previousDirectory: string;
  swaps: RestoreSwap[];
}

const RESTORE_JOURNAL = '.backup-restore-journal.json';
const RESTORE_STATE_TABLE = 'nexus_backup_restore_state';
const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`;

/** Captures/restores the Nexus product data set. Raw SQL/file layout never escapes this adapter. */
export class SqliteBackupSnapshotAdapter implements BackupSnapshotPort {
  constructor(
    private readonly database: RelationalDatabase,
    private readonly cipher: SecretCipher,
    private readonly dataDirectory: string,
  ) {}

  async capture(): Promise<BackupSnapshot> {
    return this.database.transaction(async (database) => {
      const tables: Record<string, Record<string, unknown>[]> = {};
      for (const table of TABLES) tables[table] = await this.captureTable(database, table);
      const files = await this.captureStableFiles();
      return { format: 'nexus-terminal-backup', version: 1, createdAt: new Date().toISOString(), tables, files };
    });
  }

  async restore(
    snapshot: BackupSnapshot,
  ): Promise<{ restoredTables: number; restoredRows: number; restoredFiles: number }> {
    this.validateSnapshot(snapshot);
    await this.recoverInterruptedRestore();
    const restoreId = randomUUID();
    const stagingDirectory = `.backup-restore-${restoreId}`;
    const previousDirectory = `.backup-previous-${restoreId}`;
    const stagingRoot = path.join(this.dataDirectory, stagingDirectory);
    const previousRoot = path.join(this.dataDirectory, previousDirectory);
    await mkdir(stagingRoot, { recursive: true });
    await mkdir(previousRoot, { recursive: true });
    await this.stageFiles(snapshot.files, stagingRoot);
    await this.ensureRestoreStateTable();
    const journal: RestoreJournal = {
      version: 1,
      restoreId,
      stagingDirectory,
      previousDirectory,
      swaps: await Promise.all(
        FILE_DIRECTORIES.map(async (directory) => ({
          directory,
          hadPrevious: await this.exists(path.join(this.dataDirectory, directory)),
          state: 'pending' as const,
        })),
      ),
    };
    await this.writeRestoreJournal(journal);
    let databaseCommitted = false;
    try {
      await this.swapStagedDirectories(journal);
      const databaseResult = await this.restoreTables(snapshot.tables, restoreId);
      databaseCommitted = true;
      // Once the database transaction commits, rolling files back would create a mixed snapshot.
      // Cleanup is recoverable from the durable journal, so a cleanup error must not undo the restore.
      await this.finalizeCommittedRestore(journal).catch(() => undefined);
      return { ...databaseResult, restoredFiles: snapshot.files.length };
    } catch (error) {
      if (!databaseCommitted) await this.abortUncommittedRestore(journal);
      throw error;
    }
  }

  /** Reconciles an interrupted restore before any Agent/runtime owner starts reading restored state. */
  async recoverInterruptedRestore(): Promise<void> {
    const journal = await this.readRestoreJournal();
    if (!journal) return;
    await this.ensureRestoreStateTable();
    const marker = await this.database.queryOne<{ restore_id: string }>(
      `SELECT restore_id FROM ${RESTORE_STATE_TABLE} WHERE id=1`,
    );
    if (marker?.restore_id === journal.restoreId) {
      await this.finalizeCommittedRestore(journal);
      return;
    }
    await this.abortUncommittedRestore(journal);
  }

  private async captureTable(database: RelationalDatabase, table: string): Promise<Record<string, unknown>[]> {
    if (!(await this.tableExists(database, table))) return [];
    const rows = await database.queryAll<Record<string, unknown>>(`SELECT * FROM ${quoteIdentifier(table)}`);
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

  private async captureStableFiles(): Promise<BackupFileEntry[]> {
    for (let attempt = 0; attempt < FILE_SNAPSHOT_ATTEMPTS; attempt += 1) {
      try {
        const before = await this.fileInventory();
        const files: BackupFileEntry[] = [];
        for (const entry of before) {
          const content = await readFile(entry.absolutePath);
          if (content.byteLength !== entry.size) throw new Error('BACKUP_SNAPSHOT_FILES_CHANGED');
          files.push({ path: entry.relativePath, contentBase64: content.toString('base64') });
        }
        const after = await this.fileInventory();
        if (this.inventorySignature(before) === this.inventorySignature(after)) return files;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT' && (!(error instanceof Error) || error.message !== 'BACKUP_SNAPSHOT_FILES_CHANGED')) {
          throw error;
        }
      }
    }
    throw new Error('BACKUP_SNAPSHOT_FILES_UNSTABLE');
  }

  private async fileInventory(): Promise<BackupFileInventoryEntry[]> {
    const output: BackupFileInventoryEntry[] = [];
    const walk = async (current: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('BACKUP_SNAPSHOT_FILES_CHANGED');
        throw error;
      }
      for (const entry of entries) {
        const absolutePath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(absolutePath);
          continue;
        }
        if (!entry.isFile()) continue;
        let metadata;
        try {
          metadata = await stat(absolutePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('BACKUP_SNAPSHOT_FILES_CHANGED');
          throw error;
        }
        if (!metadata.isFile()) throw new Error('BACKUP_SNAPSHOT_FILES_CHANGED');
        output.push({
          absolutePath,
          relativePath: path.relative(this.dataDirectory, absolutePath).split(path.sep).join('/'),
          size: metadata.size,
          mtimeMs: metadata.mtimeMs,
          ctimeMs: metadata.ctimeMs,
          ino: metadata.ino,
        });
      }
    };
    for (const directory of FILE_DIRECTORIES) {
      const root = path.join(this.dataDirectory, directory);
      try {
        await stat(root);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      await walk(root);
    }
    output.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    return output;
  }

  private inventorySignature(entries: readonly BackupFileInventoryEntry[]): string {
    return JSON.stringify(
      entries.map((entry) => [entry.relativePath, entry.size, entry.mtimeMs, entry.ctimeMs, entry.ino]),
    );
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
      const handle = await open(target, 'w');
      try {
        await handle.writeFile(Buffer.from(file.contentBase64, 'base64'));
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    await this.fsyncDirectory(stagingRoot);
  }

  private async swapStagedDirectories(journal: RestoreJournal): Promise<void> {
    const stagingRoot = path.join(this.dataDirectory, journal.stagingDirectory);
    const previousRoot = path.join(this.dataDirectory, journal.previousDirectory);
    for (const swap of journal.swaps) {
      const target = path.join(this.dataDirectory, swap.directory);
      const staged = path.join(stagingRoot, swap.directory);
      const previous = path.join(previousRoot, swap.directory);
      if (swap.hadPrevious) {
        swap.state = 'moving_original';
        await this.writeRestoreJournal(journal);
        await mkdir(path.dirname(previous), { recursive: true });
        await rename(target, previous);
        await this.fsyncDirectory(path.dirname(target));
        await this.fsyncDirectory(path.dirname(previous));
      }
      swap.state = 'installing';
      await this.writeRestoreJournal(journal);
      await mkdir(path.dirname(target), { recursive: true });
      await rename(staged, target);
      await this.fsyncDirectory(path.dirname(target));
      swap.state = 'swapped';
      await this.writeRestoreJournal(journal);
    }
  }

  private async rollbackSwaps(journal: RestoreJournal): Promise<void> {
    const previousRoot = path.join(this.dataDirectory, journal.previousDirectory);
    for (const swap of [...journal.swaps].reverse()) {
      if (swap.state === 'pending') continue;
      const target = path.join(this.dataDirectory, swap.directory);
      const previous = path.join(previousRoot, swap.directory);
      if (swap.hadPrevious) {
        if (await this.exists(previous)) {
          await rm(target, { recursive: true, force: true });
          await mkdir(path.dirname(target), { recursive: true });
          await rename(previous, target);
          await this.fsyncDirectory(path.dirname(target));
        }
      } else if (swap.state === 'installing' || swap.state === 'swapped') {
        await rm(target, { recursive: true, force: true });
        await this.fsyncDirectory(path.dirname(target));
      }
    }
  }

  private async restoreTables(
    tables: Record<string, Record<string, unknown>[]>,
    restoreId: string,
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
      await database.execute(
        `INSERT INTO ${RESTORE_STATE_TABLE} (id, restore_id) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET restore_id=excluded.restore_id`,
        [restoreId],
      );
      return { restoredTables, restoredRows };
    });
  }

  private async ensureRestoreStateTable(): Promise<void> {
    await this.database.execute(
      `CREATE TABLE IF NOT EXISTS ${RESTORE_STATE_TABLE} (
         id INTEGER PRIMARY KEY CHECK(id=1),
         restore_id TEXT NOT NULL
       )`,
    );
  }

  private async abortUncommittedRestore(journal: RestoreJournal): Promise<void> {
    await this.rollbackSwaps(journal);
    await rm(path.join(this.dataDirectory, journal.stagingDirectory), { recursive: true, force: true });
    await rm(path.join(this.dataDirectory, journal.previousDirectory), { recursive: true, force: true });
    await rm(this.restoreJournalPath(), { force: true });
    await this.database.execute(`DELETE FROM ${RESTORE_STATE_TABLE} WHERE id=1 AND restore_id=?`, [journal.restoreId]);
  }

  private async finalizeCommittedRestore(journal: RestoreJournal): Promise<void> {
    await rm(path.join(this.dataDirectory, journal.previousDirectory), { recursive: true, force: true });
    await rm(path.join(this.dataDirectory, journal.stagingDirectory), { recursive: true, force: true });
    await rm(this.restoreJournalPath(), { force: true });
    await this.database.execute(`DELETE FROM ${RESTORE_STATE_TABLE} WHERE id=1 AND restore_id=?`, [journal.restoreId]);
  }

  private restoreJournalPath(): string {
    return path.join(this.dataDirectory, RESTORE_JOURNAL);
  }

  private async writeRestoreJournal(journal: RestoreJournal): Promise<void> {
    const target = this.restoreJournalPath();
    const temporary = `${target}.tmp`;
    const handle = await open(temporary, 'w', 0o600);
    try {
      await handle.writeFile(JSON.stringify(journal), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
    await this.fsyncDirectory(this.dataDirectory);
  }

  private async readRestoreJournal(): Promise<RestoreJournal | null> {
    let raw: string;
    try {
      raw = await readFile(this.restoreJournalPath(), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      throw new Error('BACKUP_RESTORE_JOURNAL_INVALID');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('BACKUP_RESTORE_JOURNAL_INVALID');
    const record = value as Partial<RestoreJournal>;
    if (
      record.version !== 1 ||
      typeof record.restoreId !== 'string' ||
      record.stagingDirectory !== `.backup-restore-${record.restoreId}` ||
      record.previousDirectory !== `.backup-previous-${record.restoreId}` ||
      !Array.isArray(record.swaps) ||
      record.swaps.length !== FILE_DIRECTORIES.length
    ) {
      throw new Error('BACKUP_RESTORE_JOURNAL_INVALID');
    }
    const allowedStates = new Set<RestoreSwapState>(['pending', 'moving_original', 'installing', 'swapped']);
    for (let index = 0; index < FILE_DIRECTORIES.length; index += 1) {
      const swap = record.swaps[index];
      if (
        !swap ||
        swap.directory !== FILE_DIRECTORIES[index] ||
        typeof swap.hadPrevious !== 'boolean' ||
        !allowedStates.has(swap.state)
      ) {
        throw new Error('BACKUP_RESTORE_JOURNAL_INVALID');
      }
    }
    return record as RestoreJournal;
  }

  private async fsyncDirectory(directory: string): Promise<void> {
    const handle = await open(directory, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
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
