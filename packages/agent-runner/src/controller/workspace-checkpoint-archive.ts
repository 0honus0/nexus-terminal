import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as tar from 'tar';

export const WORKSPACE_CHECKPOINT_MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 128 * 1024 * 1024;
const MAX_ENTRIES = 32_768;
const MAX_DEPTH = 64;

export interface WorkspaceCheckpointArchiveReadHandle {
  sizeBytes: number;
  source: AsyncIterable<Uint8Array>;
  close(): Promise<void>;
}

const safeArchivePath = (raw: string): string => {
  if (!raw || raw.includes('\0') || raw.includes('\\') || path.posix.isAbsolute(raw)) {
    throw new Error('WORKSPACE_CHECKPOINT_ARCHIVE_UNSAFE');
  }
  const normalized = path.posix.normalize(raw.replace(/^\.\//, ''));
  if (normalized === '.' || normalized === '') return '.';
  if (normalized === '..' || normalized.startsWith('../') || normalized.split('/').includes('..')) {
    throw new Error('WORKSPACE_CHECKPOINT_ARCHIVE_UNSAFE');
  }
  if (normalized.split('/').length > MAX_DEPTH) throw new Error('WORKSPACE_CHECKPOINT_ARCHIVE_TOO_DEEP');
  return normalized;
};

const inspectTree = (root: string): void => {
  let entries = 0;
  let bytes = 0;
  const stack: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current.directory, { withFileTypes: true })) {
      entries += 1;
      if (entries > MAX_ENTRIES) throw new Error('WORKSPACE_CHECKPOINT_ARCHIVE_TOO_MANY_FILES');
      const target = path.join(current.directory, entry.name);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
        throw new Error('WORKSPACE_CHECKPOINT_ARCHIVE_UNSAFE');
      }
      if (entry.isDirectory()) {
        if (current.depth + 1 > MAX_DEPTH) throw new Error('WORKSPACE_CHECKPOINT_ARCHIVE_TOO_DEEP');
        stack.push({ directory: target, depth: current.depth + 1 });
        continue;
      }
      if (stat.size > MAX_SINGLE_FILE_BYTES) throw new Error('WORKSPACE_CHECKPOINT_FILE_TOO_LARGE');
      bytes += stat.size;
      if (bytes > MAX_EXPANDED_BYTES) throw new Error('WORKSPACE_CHECKPOINT_ARCHIVE_TOO_LARGE');
    }
  }
};

const validateArchive = async (archive: string): Promise<void> => {
  let entries = 0;
  let expandedBytes = 0;
  const seen = new Set<string>();
  await tar.t({
    file: archive,
    strict: true,
    onentry: (entry) => {
      entries += 1;
      if (entries > MAX_ENTRIES) throw new Error('WORKSPACE_CHECKPOINT_ARCHIVE_TOO_MANY_FILES');
      const normalized = safeArchivePath(entry.path);
      if (normalized !== '.') {
        if (seen.has(normalized)) throw new Error('WORKSPACE_CHECKPOINT_ARCHIVE_DUPLICATE_PATH');
        seen.add(normalized);
      }
      if (entry.type !== 'File' && entry.type !== 'Directory') throw new Error('WORKSPACE_CHECKPOINT_ARCHIVE_UNSAFE');
      if (entry.linkpath) throw new Error('WORKSPACE_CHECKPOINT_ARCHIVE_UNSAFE');
      if (entry.type === 'File') {
        if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_SINGLE_FILE_BYTES) {
          throw new Error('WORKSPACE_CHECKPOINT_FILE_TOO_LARGE');
        }
        expandedBytes += entry.size;
        if (expandedBytes > MAX_EXPANDED_BYTES) throw new Error('WORKSPACE_CHECKPOINT_ARCHIVE_TOO_LARGE');
      }
    },
  });
};

const streamFile = async function* (file: string): AsyncIterable<Uint8Array> {
  for await (const chunk of fs.createReadStream(file)) yield Buffer.from(chunk);
};

export const createWorkspaceCheckpointArchive = async (
  workRoot: string,
  scratchRoot: string,
): Promise<WorkspaceCheckpointArchiveReadHandle> => {
  inspectTree(workRoot);
  fs.mkdirSync(scratchRoot, { recursive: true, mode: 0o700 });
  const archive = path.join(scratchRoot, `checkpoint-${randomUUID()}.tar`);
  try {
    await tar.c(
      {
        cwd: workRoot,
        file: archive,
        portable: true,
        noMtime: true,
        strict: true,
      },
      ['.'],
    );
    const stat = fs.lstatSync(archive);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size < 1 ||
      stat.size > WORKSPACE_CHECKPOINT_MAX_ARCHIVE_BYTES
    ) {
      throw new Error('WORKSPACE_CHECKPOINT_ARCHIVE_TOO_LARGE');
    }
    await validateArchive(archive);
    return {
      sizeBytes: stat.size,
      source: streamFile(archive),
      close: async () => {
        await fs.promises.rm(archive, { force: true });
      },
    };
  } catch (error) {
    fs.rmSync(archive, { force: true });
    throw error;
  }
};

type WorkspaceCheckpointRestoreTransaction = {
  version: 1;
  token: string;
  phase: 'prepared' | 'backup-moved';
};

const RESTORE_TRANSACTION_FILE = 'restore-transaction.json';

const restoreTransactionPath = (scratchRoot: string): string => path.join(scratchRoot, RESTORE_TRANSACTION_FILE);

const writeRestoreTransaction = (scratchRoot: string, transaction: WorkspaceCheckpointRestoreTransaction): void => {
  fs.mkdirSync(scratchRoot, { recursive: true, mode: 0o700 });
  const target = restoreTransactionPath(scratchRoot);
  const temporary = `${target}.${process.pid}.tmp`;
  const fd = fs.openSync(temporary, 'w', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(transaction));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, target);
};

const readRestoreTransaction = (scratchRoot: string): WorkspaceCheckpointRestoreTransaction | null => {
  const target = restoreTransactionPath(scratchRoot);
  if (!fs.existsSync(target)) return null;
  const parsed = JSON.parse(fs.readFileSync(target, 'utf8')) as Partial<WorkspaceCheckpointRestoreTransaction>;
  if (
    parsed.version !== 1 ||
    typeof parsed.token !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(parsed.token) ||
    (parsed.phase !== 'prepared' && parsed.phase !== 'backup-moved')
  ) {
    throw new Error('WORKSPACE_CHECKPOINT_RESTORE_TRANSACTION_INVALID');
  }
  return parsed as WorkspaceCheckpointRestoreTransaction;
};

export const recoverWorkspaceCheckpointRestore = (workRoot: string, scratchRoot: string): boolean => {
  const transaction = readRestoreTransaction(scratchRoot);
  if (!transaction) return false;
  const staging = path.join(scratchRoot, `restore-${transaction.token}`);
  const archive = path.join(scratchRoot, `restore-${transaction.token}.tar`);
  const backup = path.join(scratchRoot, `work-backup-${transaction.token}`);

  if (fs.existsSync(backup)) {
    if (fs.existsSync(workRoot)) fs.rmSync(workRoot, { recursive: true, force: true });
    fs.renameSync(backup, workRoot);
  } else if (!fs.existsSync(workRoot)) {
    throw new Error('WORKSPACE_CHECKPOINT_RESTORE_RECOVERY_REQUIRED');
  }

  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(archive, { force: true });
  fs.rmSync(backup, { recursive: true, force: true });
  fs.rmSync(restoreTransactionPath(scratchRoot), { force: true });
  return true;
};

export const restoreWorkspaceCheckpointArchive = async (
  workRoot: string,
  scratchRoot: string,
  source: AsyncIterable<Uint8Array>,
  expectedBytes: number,
): Promise<void> => {
  if (
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes < 1 ||
    expectedBytes > WORKSPACE_CHECKPOINT_MAX_ARCHIVE_BYTES
  ) {
    throw new Error('WORKSPACE_CHECKPOINT_ARCHIVE_TOO_LARGE');
  }
  fs.mkdirSync(scratchRoot, { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const archive = path.join(scratchRoot, `restore-${token}.tar`);
  const staging = path.join(scratchRoot, `restore-${token}`);
  const backup = path.join(scratchRoot, `work-backup-${token}`);
  let handle: fs.promises.FileHandle | null = null;
  let written = 0;
  try {
    handle = await fs.promises.open(archive, 'wx', 0o600);
    for await (const rawChunk of source) {
      const chunk = Buffer.from(rawChunk);
      written += chunk.byteLength;
      if (written > expectedBytes || written > WORKSPACE_CHECKPOINT_MAX_ARCHIVE_BYTES) {
        throw new Error('WORKSPACE_CHECKPOINT_ARCHIVE_SIZE_MISMATCH');
      }
      await handle.write(chunk);
    }
    await handle.sync();
    await handle.close();
    handle = null;
    if (written !== expectedBytes) throw new Error('WORKSPACE_CHECKPOINT_ARCHIVE_SIZE_MISMATCH');
    await validateArchive(archive);

    fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
    await tar.x({
      file: archive,
      cwd: staging,
      strict: true,
      preservePaths: false,
      preserveOwner: false,
      noMtime: true,
      unlink: true,
      maxDepth: MAX_DEPTH,
      onentry: (entry) => {
        safeArchivePath(entry.path);
        if (entry.type !== 'File' && entry.type !== 'Directory') throw new Error('WORKSPACE_CHECKPOINT_ARCHIVE_UNSAFE');
        if (entry.linkpath) throw new Error('WORKSPACE_CHECKPOINT_ARCHIVE_UNSAFE');
      },
    });

    if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
    writeRestoreTransaction(scratchRoot, { version: 1, token, phase: 'prepared' });
    fs.renameSync(workRoot, backup);
    writeRestoreTransaction(scratchRoot, { version: 1, token, phase: 'backup-moved' });
    fs.renameSync(staging, workRoot);
    fs.rmSync(backup, { recursive: true, force: true });
    fs.rmSync(restoreTransactionPath(scratchRoot), { force: true });
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    if (fs.existsSync(restoreTransactionPath(scratchRoot))) {
      recoverWorkspaceCheckpointRestore(workRoot, scratchRoot);
    } else {
      fs.rmSync(archive, { force: true });
      fs.rmSync(staging, { recursive: true, force: true });
      fs.rmSync(backup, { recursive: true, force: true });
    }
  }
};
