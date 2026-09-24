import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteBackupSnapshotAdapter } from '../../packages/backend/src/infrastructure/backup/sqlite-backup-snapshot.adapter';
import { DatabaseAdapter } from '../../packages/backend/src/infrastructure/database/database.adapter';
import { AesGcmSecretCipher } from '../../packages/backend/src/infrastructure/security/aes-gcm-secret-cipher';

const KEY = '33'.repeat(32);
const directories = ['background', 'custom_html_theme', 'agent/artifacts/objects', 'agent/plugins'] as const;

const journal = (restoreId: string, firstState: 'installing' | 'swapped') => ({
  version: 1,
  restoreId,
  stagingDirectory: `.backup-restore-${restoreId}`,
  previousDirectory: `.backup-previous-${restoreId}`,
  swaps: directories.map((directory, index) => ({
    directory,
    hadPrevious: index === 0,
    state: index === 0 ? firstState : 'pending',
  })),
});

const main = async (): Promise<void> => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-backup-restore-journal-'));
  const db = new DatabaseAdapter({ dataDirectory: root, filename: 'recovery.sqlite', nodeEnv: 'test' });
  const backup = new SqliteBackupSnapshotAdapter(db, new AesGcmSecretCipher(KEY), root);
  try {
    await db.initialize();

    // Simulate the historical second-rename failure: the original target already moved to
    // previous, but installing the staged directory never completed.
    const abortedId = 'aborted-fixture';
    const aborted = journal(abortedId, 'installing');
    const abortedPrevious = path.join(root, aborted.previousDirectory, 'background');
    const abortedStaging = path.join(root, aborted.stagingDirectory);
    fs.mkdirSync(abortedPrevious, { recursive: true });
    fs.mkdirSync(abortedStaging, { recursive: true });
    fs.writeFileSync(path.join(abortedPrevious, 'state.txt'), 'old-state');
    fs.writeFileSync(path.join(root, '.backup-restore-journal.json'), JSON.stringify(aborted));

    await backup.recoverInterruptedRestore();

    assert.equal(fs.readFileSync(path.join(root, 'background', 'state.txt'), 'utf8'), 'old-state');
    assert(!fs.existsSync(path.join(root, aborted.previousDirectory)));
    assert(!fs.existsSync(path.join(root, aborted.stagingDirectory)));
    assert(!fs.existsSync(path.join(root, '.backup-restore-journal.json')));

    // Simulate a crash after DB COMMIT but before file cleanup. The in-DB restore token is
    // committed in the same transaction as restored rows, so recovery must roll forward.
    const committedId = 'committed-fixture';
    const committed = journal(committedId, 'swapped');
    const committedTarget = path.join(root, 'background');
    const committedPrevious = path.join(root, committed.previousDirectory, 'background');
    const committedStaging = path.join(root, committed.stagingDirectory);
    fs.rmSync(committedTarget, { recursive: true, force: true });
    fs.mkdirSync(committedTarget, { recursive: true });
    fs.mkdirSync(committedPrevious, { recursive: true });
    fs.mkdirSync(committedStaging, { recursive: true });
    fs.writeFileSync(path.join(committedTarget, 'state.txt'), 'new-state');
    fs.writeFileSync(path.join(committedPrevious, 'state.txt'), 'old-state');
    fs.writeFileSync(path.join(root, '.backup-restore-journal.json'), JSON.stringify(committed));
    await db.execute(
      `CREATE TABLE IF NOT EXISTS nexus_backup_restore_state (
         id INTEGER PRIMARY KEY CHECK(id=1),
         restore_id TEXT NOT NULL
       )`,
    );
    await db.execute('INSERT OR REPLACE INTO nexus_backup_restore_state (id, restore_id) VALUES (1, ?)', [committedId]);

    await backup.recoverInterruptedRestore();

    assert.equal(fs.readFileSync(path.join(committedTarget, 'state.txt'), 'utf8'), 'new-state');
    assert(!fs.existsSync(path.join(root, committed.previousDirectory)));
    assert(!fs.existsSync(path.join(root, committed.stagingDirectory)));
    assert(!fs.existsSync(path.join(root, '.backup-restore-journal.json')));
    assert.equal(await db.queryOne('SELECT restore_id FROM nexus_backup_restore_state WHERE id=1'), null);

    const composition = fs.readFileSync(
      new URL('../../packages/backend/src/bootstrap/composition-root.ts', import.meta.url),
      'utf8',
    );
    const databaseInitialize = composition.indexOf('await database.initialize();');
    const restoreRecovery = composition.indexOf('await backupSnapshots.recoverInterruptedRestore();');
    const agentInitialize = composition.indexOf('await agent.initialize();');
    assert(databaseInitialize >= 0 && restoreRecovery > databaseInitialize && agentInitialize > restoreRecovery);

    process.stdout.write('backup restore journal recovery regression: PASS\n');
  } finally {
    await db.close().catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
