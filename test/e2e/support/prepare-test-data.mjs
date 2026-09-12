import fs from 'node:fs';
import path from 'node:path';

const dataDir = process.env.NEXUS_DATA_DIR;
if (!dataDir) {
  throw new Error('NEXUS_DATA_DIR is required for E2E test data preparation.');
}

const resolvedDataDir = path.resolve(dataDir);
const unlockForRemoval = (target) => {
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    fs.chmodSync(target, 0o700);
    for (const name of fs.readdirSync(target)) unlockForRemoval(path.join(target, name));
    return;
  }
  if (stat.isFile()) fs.chmodSync(target, 0o600);
};
unlockForRemoval(resolvedDataDir);
fs.rmSync(resolvedDataDir, { recursive: true, force: true });
fs.mkdirSync(resolvedDataDir, { recursive: true });

const seedDb = process.env.NEXUS_E2E_SEED_DB;
if (seedDb) {
  const resolvedSeedDb = path.resolve(seedDb);
  if (!fs.existsSync(resolvedSeedDb)) {
    throw new Error(`NEXUS_E2E_SEED_DB does not exist: ${resolvedSeedDb}`);
  }
  fs.copyFileSync(resolvedSeedDb, path.join(resolvedDataDir, 'nexus-terminal.db'));
  console.log(`[E2E] Copied seeded database: ${resolvedSeedDb}`);
}

console.log(`[E2E] Prepared isolated backend data directory: ${resolvedDataDir}`);
