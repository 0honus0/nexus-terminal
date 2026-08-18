import fs from 'node:fs';
import path from 'node:path';

const dataDir = process.env.NEXUS_DATA_DIR;
if (!dataDir) {
  throw new Error('NEXUS_DATA_DIR is required for E2E test data preparation.');
}

const resolvedDataDir = path.resolve(dataDir);
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
