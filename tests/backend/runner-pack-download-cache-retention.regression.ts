import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PackInstaller } from '../../packages/agent-runner/src/controller/pack-installer';

const digest = `sha256:${'a'.repeat(64)}`;
const ref = { familyId: 'node', versionId: '1.2.3', contentDigest: digest };

const catalog = {
  pack: () => ({
    familyId: ref.familyId,
    versionId: ref.versionId,
    contentDigestByArch: { [process.arch]: digest },
    downloadRefByArch: { [process.arch]: `builtin://${ref.familyId}/${ref.versionId}/${process.arch}` },
    dependencies: [],
  }),
} as never;

const main = async (): Promise<void> => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-pack-cache-retention-'));
  const cacheRoot = path.join(root, 'cache');
  const orphan = path.join(cacheRoot, 'download', 'orphan-command');
  fs.mkdirSync(orphan, { recursive: true });
  fs.writeFileSync(path.join(orphan, 'archive.tar'), 'orphan');

  const store = {
    installed: () => false,
    activate: () => undefined,
  } as never;
  const installer = new PackInstaller(catalog, store, cacheRoot);
  assert.equal(fs.existsSync(orphan), false, 'startup must sweep command-scoped download leftovers');

  const internal = installer as unknown as {
    installOne: (_pack: unknown, _ref: unknown, commandId: string) => Promise<void>;
  };

  internal.installOne = async (_pack, _candidate, commandId) => {
    const directory = path.join(cacheRoot, 'download', commandId);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'archive.tar'), 'temporary');
  };
  await installer.ensure([ref], 'success-command');
  assert.equal(
    fs.existsSync(path.join(cacheRoot, 'download', 'success-command')),
    false,
    'successful ensure must release its command-scoped download owner',
  );

  internal.installOne = async (_pack, _candidate, commandId) => {
    const directory = path.join(cacheRoot, 'download', commandId);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'archive.tar'), 'temporary');
    throw new Error('INJECTED_INSTALL_FAILURE');
  };
  await assert.rejects(installer.ensure([ref], 'failed-command'), /INJECTED_INSTALL_FAILURE/);
  assert.equal(
    fs.existsSync(path.join(cacheRoot, 'download', 'failed-command')),
    false,
    'failed ensure must release its command-scoped download owner',
  );

  fs.rmSync(root, { recursive: true, force: true });
  process.stdout.write('runner pack download cache retention regression: PASS\n');
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
