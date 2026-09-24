import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RunnerJournal } from '../../packages/agent-runner/src/controller/journal';

const expectInvalid = (journalFile: string): void => {
  assert.throws(() => new RunnerJournal(journalFile), /RUNNER_JOURNAL_INVALID/);
};

const evidenceFiles = (directory: string): string[] =>
  fs
    .readdirSync(directory)
    .filter((name) => name.startsWith('journal.json.corrupt.'))
    .sort();

const main = (): void => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-journal-corrupt-retention-'));
  try {
    const journalFile = path.join(directory, 'journal.json');
    const marker = `${journalFile}.corrupt-marker`;
    const original = '{"schemaVersion":4,"commands":"corrupt"}';
    fs.writeFileSync(journalFile, original);

    expectInvalid(journalFile);
    assert.equal(fs.existsSync(journalFile), false, 'corrupt main journal must be renamed away');
    assert.equal(fs.existsSync(marker), true, 'fail-closed marker must survive supervisor restarts');
    assert.equal(evidenceFiles(directory).length, 1);
    assert.equal(fs.readFileSync(path.join(directory, evidenceFiles(directory)[0]!), 'utf8'), original);

    for (let attempt = 0; attempt < 5; attempt += 1) expectInvalid(journalFile);
    assert.equal(
      evidenceFiles(directory).length,
      1,
      'restarting against the same corrupt marker must not duplicate forensic evidence',
    );

    for (let event = 0; event < 6; event += 1) {
      fs.rmSync(marker, { force: true });
      fs.writeFileSync(journalFile, `{"schemaVersion":4,"commands":"corrupt-${event}"}`);
      expectInvalid(journalFile);
    }
    assert.equal(
      evidenceFiles(directory).length,
      4,
      'different explicit recovery/corruption events must retain only a bounded number of evidence files',
    );
    assert.equal(fs.existsSync(marker), true);

    process.stdout.write('Runner journal corrupt evidence retention regression: PASS\n');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

main();
