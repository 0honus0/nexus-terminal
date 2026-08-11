import fs from 'node:fs';
import path from 'node:path';

const dataDir = process.env.NEXUS_DATA_DIR;
if (!dataDir) {
  throw new Error('NEXUS_DATA_DIR is required for E2E test data preparation.');
}

const resolvedDataDir = path.resolve(dataDir);
fs.rmSync(resolvedDataDir, { recursive: true, force: true });
fs.mkdirSync(resolvedDataDir, { recursive: true });

console.log(`[E2E] Prepared isolated backend data directory: ${resolvedDataDir}`);
