import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteBackupSnapshotAdapter } from '../../packages/backend/src/infrastructure/backup/sqlite-backup-snapshot.adapter';
import { DatabaseAdapter } from '../../packages/backend/src/infrastructure/database/database.adapter';
import { AesGcmSecretCipher } from '../../packages/backend/src/infrastructure/security/aes-gcm-secret-cipher';
import { BackupService } from '../../packages/backend/src/modules/backup/backup.service';
import type { BackupCodecPort, BackupSnapshotPort } from '../../packages/backend/src/modules/backup/backup.port';
import type { BackupFileEntry, BackupSnapshot } from '../../packages/backend/src/modules/backup/backup.types';
import type { UserService } from '../../packages/backend/src/modules/user/user.service';
import type { PasswordHasher } from '../../packages/backend/src/shared/security/crypto.port';

const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

const snapshotFixture = (): BackupSnapshot => ({
  format: 'nexus-terminal-backup',
  version: 1,
  createdAt: new Date(0).toISOString(),
  tables: {},
  files: [],
});

const verifyCaptureBarrier = async (): Promise<void> => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-backup-capture-barrier-'));
  const database = new DatabaseAdapter({ dataDirectory: directory, filename: 'backup.sqlite', nodeEnv: 'test' });
  try {
    await database.initialize();
    await database.execute("INSERT INTO settings (key, value) VALUES ('snapshot-probe', 'before')");

    const adapter = new SqliteBackupSnapshotAdapter(database, new AesGcmSecretCipher('11'.repeat(32)), directory);
    const internals = adapter as unknown as {
      captureStableFiles(): Promise<BackupFileEntry[]>;
    };
    const originalCaptureStableFiles = internals.captureStableFiles.bind(adapter);
    let enteredResolve: (() => void) | undefined;
    let releaseResolve: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredResolve = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseResolve = resolve;
    });
    internals.captureStableFiles = async () => {
      enteredResolve?.();
      await release;
      return originalCaptureStableFiles();
    };

    const capturePromise = adapter.capture();
    await entered;

    let writerCompleted = false;
    const writer = database.execute("UPDATE settings SET value='after' WHERE key='snapshot-probe'").then(() => {
      writerCompleted = true;
    });
    await sleep(30);
    assert.equal(
      writerCompleted,
      false,
      'database mutation must remain blocked while backup tables/files share one capture transaction',
    );

    releaseResolve?.();
    const snapshot = await capturePromise;
    await writer;

    const captured = snapshot.tables.settings?.find((row) => row.key === 'snapshot-probe');
    assert.equal(captured?.value, 'before', 'snapshot must retain the pre-mutation database view');
    assert.equal(
      (await database.queryOne<{ value: string }>("SELECT value FROM settings WHERE key='snapshot-probe'"))?.value,
      'after',
    );
  } finally {
    await database.close().catch(() => undefined);
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

const verifyServiceSerialization = async (): Promise<void> => {
  let active = 0;
  let maxActive = 0;
  const operations: string[] = [];
  const enter = async (name: string): Promise<void> => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    operations.push(`start:${name}`);
    await sleep(25);
    operations.push(`end:${name}`);
    active -= 1;
  };

  const snapshots: BackupSnapshotPort = {
    capture: async () => {
      await enter('capture');
      return snapshotFixture();
    },
    restore: async () => {
      await enter('restore');
      return { restoredTables: 0, restoredRows: 0, restoredFiles: 0 };
    },
  };
  const codec: BackupCodecPort = {
    encode: async () => Uint8Array.of(1),
    decode: async () => ({ snapshot: snapshotFixture(), usedPassword: true }),
  };
  const users = {
    getStored: async () => ({ hashedPassword: 'hash' }),
  } as unknown as UserService;
  const hasher = {
    compare: async () => true,
  } as unknown as PasswordHasher;
  const service = new BackupService(snapshots, codec, users, hasher);

  await Promise.all([
    service.exportFull(1, 'password'),
    service.importFull(Uint8Array.of(1), 'password'),
    service.importFull(Uint8Array.of(2), 'password'),
  ]);

  assert.equal(maxActive, 1, 'export and restore operations must share one process-local exclusive lane');
  assert.equal(operations.length, 6);
  for (let index = 0; index < operations.length; index += 2) {
    const started = operations[index]?.replace('start:', '');
    assert.equal(
      operations[index + 1],
      `end:${started}`,
      'each exclusive operation must finish before the next starts',
    );
  }
  assert.equal(operations.filter((value) => value === 'start:capture').length, 1);
  assert.equal(operations.filter((value) => value === 'start:restore').length, 2);
};

const main = async (): Promise<void> => {
  await verifyCaptureBarrier();
  await verifyServiceSerialization();
  process.stdout.write('backup consistency serialization regression: PASS\n');
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
