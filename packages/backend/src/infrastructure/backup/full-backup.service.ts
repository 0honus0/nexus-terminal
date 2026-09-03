import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { allDb, getDbInstance } from '../database/connection';
import { decrypt, encrypt } from '../../shared/security/crypto';

const BACKUP_MAGIC = 'NEXUS_TERMINAL_BACKUP_V1\n';
const BACKUP_FORMAT = 'nexus-terminal-backup';
const BACKUP_VERSION = 1;
const PBKDF2_ITERATIONS = 210_000;
const DATA_ROOT = path.resolve(__dirname, '../../../data');

const BACKUP_TABLES = [
  'settings',
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

const SENSITIVE_COLUMNS: Record<string, string[]> = {
  proxies: ['encrypted_password', 'encrypted_private_key', 'encrypted_passphrase'],
  ssh_keys: ['encrypted_private_key', 'encrypted_passphrase'],
  connections: ['encrypted_password', 'encrypted_private_key', 'encrypted_passphrase'],
};

interface CipherPayload {
  iv: string;
  ciphertext: string;
  tag: string;
}

interface BackupEnvelope {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  passwordKdf: {
    algorithm: 'pbkdf2-sha256';
    salt: string;
    iterations: number;
  };
  instanceWrappedKey: CipherPayload;
  passwordWrappedKey: CipherPayload;
  payload: CipherPayload;
}

interface BackupFileEntry {
  path: string;
  contentBase64: string;
}

interface BackupPayload {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  tables: Record<string, Record<string, unknown>[]>;
  files: BackupFileEntry[];
}

export interface BackupImportResult {
  restoredTables: number;
  restoredRows: number;
  restoredFiles: number;
  usedPassword: boolean;
}

export class BackupPasswordRequiredError extends Error {
  readonly code = 'BACKUP_PASSWORD_REQUIRED';

  constructor() {
    super('该备份来自其他实例，请输入导出时使用的登录密码。');
    this.name = 'BackupPasswordRequiredError';
  }
}

export class InvalidBackupPasswordError extends Error {
  readonly code = 'INVALID_BACKUP_PASSWORD';

  constructor() {
    super('备份密码不正确，或备份文件已损坏。');
    this.name = 'InvalidBackupPasswordError';
  }
}

const encryptAesGcm = (plaintext: Buffer, key: Buffer): CipherPayload => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: tag.toString('base64'),
  };
};

const decryptAesGcm = (payload: CipherPayload, key: Buffer): Buffer => {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]);
};

const deriveInstanceWrappingKey = (): Buffer => {
  const instanceSecret = process.env.ENCRYPTION_KEY;
  if (!instanceSecret) {
    throw new Error('ENCRYPTION_KEY is not set.');
  }
  return crypto.createHash('sha256').update(`nexus-backup-instance:${instanceSecret}`).digest();
};

const derivePasswordWrappingKey = (password: string, salt: Buffer, iterations: number): Buffer =>
  crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');

const tableExists = async (tableName: string): Promise<boolean> => {
  const db = await getDbInstance();
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  return Boolean(row);
};

const exportTableRows = async (tableName: string): Promise<Record<string, unknown>[]> => {
  if (!(await tableExists(tableName))) return [];
  const db = await getDbInstance();
  const rows = await allDb<Record<string, unknown>>(db, `SELECT * FROM "${tableName}"`);
  const sensitiveColumns = SENSITIVE_COLUMNS[tableName] ?? [];

  if (sensitiveColumns.length === 0) return rows;

  return rows.map((sourceRow) => {
    const row = { ...sourceRow };
    const plaintext: Record<string, string | null> = {};
    for (const column of sensitiveColumns) {
      const encryptedValue = row[column];
      plaintext[column] =
        typeof encryptedValue === 'string' && encryptedValue.length > 0 ? decrypt(encryptedValue) : null;
      row[column] = null;
    }
    row.__backup_plaintext = plaintext;
    return row;
  });
};

const collectDirectoryFiles = (directoryName: string): BackupFileEntry[] => {
  const root = path.join(DATA_ROOT, directoryName);
  if (!fs.existsSync(root)) return [];
  const entries: BackupFileEntry[] = [];

  const walk = (currentPath: string): void => {
    for (const item of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const absolutePath = path.join(currentPath, item.name);
      if (item.isDirectory()) {
        walk(absolutePath);
      } else if (item.isFile()) {
        const relativePath = path.relative(DATA_ROOT, absolutePath).split(path.sep).join('/');
        entries.push({
          path: relativePath,
          contentBase64: fs.readFileSync(absolutePath).toString('base64'),
        });
      }
    }
  };

  walk(root);
  return entries;
};

const buildBackupPayload = async (): Promise<BackupPayload> => {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const tableName of BACKUP_TABLES) {
    tables[tableName] = await exportTableRows(tableName);
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    tables,
    files: FILE_DIRECTORIES.flatMap(collectDirectoryFiles),
  };
};

export const createFullBackup = async (password: string): Promise<Buffer> => {
  if (!password) throw new Error('导出备份需要当前登录密码。');

  const payload = await buildBackupPayload();
  const dataKey = crypto.randomBytes(32);
  const salt = crypto.randomBytes(16);
  const passwordKey = derivePasswordWrappingKey(password, salt, PBKDF2_ITERATIONS);
  const instanceKey = deriveInstanceWrappingKey();

  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: payload.createdAt,
    passwordKdf: {
      algorithm: 'pbkdf2-sha256',
      salt: salt.toString('base64'),
      iterations: PBKDF2_ITERATIONS,
    },
    instanceWrappedKey: encryptAesGcm(dataKey, instanceKey),
    passwordWrappedKey: encryptAesGcm(dataKey, passwordKey),
    payload: encryptAesGcm(Buffer.from(JSON.stringify(payload), 'utf8'), dataKey),
  };

  return Buffer.from(BACKUP_MAGIC + JSON.stringify(envelope), 'utf8');
};

const isCipherPayload = (value: unknown): value is CipherPayload => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return ['iv', 'ciphertext', 'tag'].every((key) => typeof payload[key] === 'string' && payload[key].length > 0);
};

const parseBackupEnvelope = (backupBuffer: Buffer): BackupEnvelope => {
  const content = backupBuffer.toString('utf8');
  if (!content.startsWith(BACKUP_MAGIC)) {
    throw new Error('不是有效的 Nexus Terminal 备份文件。');
  }

  const envelope = JSON.parse(content.slice(BACKUP_MAGIC.length)) as BackupEnvelope;
  if (envelope.format !== BACKUP_FORMAT || envelope.version !== BACKUP_VERSION) {
    throw new Error('备份文件版本不受支持。');
  }
  if (
    envelope.passwordKdf?.algorithm !== 'pbkdf2-sha256' ||
    envelope.passwordKdf.iterations !== PBKDF2_ITERATIONS ||
    typeof envelope.passwordKdf.salt !== 'string' ||
    envelope.passwordKdf.salt.length === 0 ||
    !isCipherPayload(envelope.instanceWrappedKey) ||
    !isCipherPayload(envelope.passwordWrappedKey) ||
    !isCipherPayload(envelope.payload)
  ) {
    throw new Error('备份文件加密参数无效。');
  }
  return envelope;
};

const decryptBackupPayload = (
  envelope: BackupEnvelope,
  password?: string,
): { payload: BackupPayload; usedPassword: boolean } => {
  let dataKey: Buffer | null = null;
  let usedPassword = false;

  try {
    dataKey = decryptAesGcm(envelope.instanceWrappedKey, deriveInstanceWrappingKey());
  } catch {
    if (!password) throw new BackupPasswordRequiredError();
    try {
      const salt = Buffer.from(envelope.passwordKdf.salt, 'base64');
      const passwordKey = derivePasswordWrappingKey(password, salt, envelope.passwordKdf.iterations);
      dataKey = decryptAesGcm(envelope.passwordWrappedKey, passwordKey);
      usedPassword = true;
    } catch {
      throw new InvalidBackupPasswordError();
    }
  }

  try {
    const payload = JSON.parse(decryptAesGcm(envelope.payload, dataKey).toString('utf8')) as BackupPayload;
    if (payload.format !== BACKUP_FORMAT || payload.version !== BACKUP_VERSION) {
      throw new Error('备份载荷版本不受支持。');
    }
    return { payload, usedPassword };
  } catch (error) {
    if (usedPassword) throw new InvalidBackupPasswordError();
    throw error;
  }
};

const prepareRowForImport = (tableName: string, sourceRow: Record<string, unknown>): Record<string, unknown> => {
  const row = { ...sourceRow };
  const plaintext = row.__backup_plaintext;
  delete row.__backup_plaintext;

  if (plaintext && typeof plaintext === 'object' && !Array.isArray(plaintext)) {
    for (const column of SENSITIVE_COLUMNS[tableName] ?? []) {
      const plainValue = (plaintext as Record<string, unknown>)[column];
      row[column] = typeof plainValue === 'string' && plainValue.length > 0 ? encrypt(plainValue) : null;
    }
  }

  return row;
};

const restoreTables = async (
  tables: Record<string, Record<string, unknown>[]>,
): Promise<{ tableCount: number; rowCount: number }> => {
  const db = await getDbInstance();
  let transactionStarted = false;
  let tableCount = 0;
  let rowCount = 0;

  try {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('BEGIN IMMEDIATE;');
    transactionStarted = true;

    for (const tableName of [...BACKUP_TABLES].reverse()) {
      if (await tableExists(tableName)) db.exec(`DELETE FROM "${tableName}";`);
    }

    for (const tableName of BACKUP_TABLES) {
      if (!(await tableExists(tableName))) continue;
      const targetColumns = new Set(
        (db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>).map((column) => column.name),
      );
      const rows = Array.isArray(tables[tableName]) ? tables[tableName] : [];

      for (const sourceRow of rows) {
        const preparedRow = prepareRowForImport(tableName, sourceRow);
        const columns = Object.keys(preparedRow).filter((column) => targetColumns.has(column));
        if (columns.length === 0) continue;
        const values = columns.map((column) => preparedRow[column] as any);
        const quotedColumns = columns.map((column) => `"${column}"`).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        db.prepare(`INSERT INTO "${tableName}" (${quotedColumns}) VALUES (${placeholders})`).run(...values);
        rowCount += 1;
      }
      tableCount += 1;
    }

    db.exec('COMMIT;');
    transactionStarted = false;
    return { tableCount, rowCount };
  } catch (error) {
    if (transactionStarted) {
      try {
        db.exec('ROLLBACK;');
      } catch {
        /* preserve original error */
      }
    }
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
};

const resolveSafeDataPath = (relativePath: string): string => {
  const normalized = relativePath.replace(/\\/g, '/');
  if (!FILE_DIRECTORIES.some((directory) => normalized === directory || normalized.startsWith(`${directory}/`))) {
    throw new Error(`备份包含不允许的文件路径: ${relativePath}`);
  }
  const absolutePath = path.resolve(DATA_ROOT, normalized);
  if (!absolutePath.startsWith(`${DATA_ROOT}${path.sep}`)) {
    throw new Error(`备份包含不安全的文件路径: ${relativePath}`);
  }
  return absolutePath;
};

const restoreFiles = (files: BackupFileEntry[]): number => {
  for (const directoryName of FILE_DIRECTORIES) {
    const target = path.join(DATA_ROOT, directoryName);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
  }

  let restoredFiles = 0;
  for (const file of files) {
    if (!file || typeof file.path !== 'string' || typeof file.contentBase64 !== 'string') continue;
    const targetPath = resolveSafeDataPath(file.path);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, Buffer.from(file.contentBase64, 'base64'));
    restoredFiles += 1;
  }
  return restoredFiles;
};

export const importFullBackup = async (backupBuffer: Buffer, password?: string): Promise<BackupImportResult> => {
  const envelope = parseBackupEnvelope(backupBuffer);
  const { payload, usedPassword } = decryptBackupPayload(envelope, password);
  const files = Array.isArray(payload.files) ? payload.files : [];
  for (const file of files) {
    if (!file || typeof file.path !== 'string' || typeof file.contentBase64 !== 'string') {
      throw new Error('备份包含无效的文件条目。');
    }
    resolveSafeDataPath(file.path);
  }
  const { tableCount, rowCount } = await restoreTables(payload.tables);
  const restoredFiles = restoreFiles(files);

  return {
    restoredTables: tableCount,
    restoredRows: rowCount,
    restoredFiles,
    usedPassword,
  };
};
