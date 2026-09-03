import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_ADMIN } from './test-identity';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const e2eRoot = path.resolve(__dirname, '..');
const seedDir = path.join(e2eRoot, 'fixtures', 'seeded-data');
const seedDbPath = path.join(seedDir, 'nexus-terminal.db');

async function main(): Promise<void> {
  fs.rmSync(seedDir, { recursive: true, force: true });
  fs.mkdirSync(seedDir, { recursive: true });
  process.env.NEXUS_DATA_DIR = seedDir;

  const { getDbInstance, closeDbInstance } = await import('../../../packages/backend/src/infrastructure/database/connection');
  const db = await getDbInstance();

  // Stable bcrypt hash for E2e-Admin-Password-2026! with cost 10.
  const hashedPassword = '$2b$10$kC2f88FaKPXUfZWXZvRTh.XnocT27Hx4cnJ/1G6Khe81RIVqhGLse';
  const timestamp = 1_700_000_000;

  db.prepare(
    'INSERT INTO users (username, hashed_password, two_factor_secret, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)',
  ).run(E2E_ADMIN.username, hashedPassword, timestamp, timestamp);

  await closeDbInstance();
  console.log(`[E2E] Wrote seeded database for ${E2E_ADMIN.username}: ${seedDbPath}`);
}

main().catch((error) => {
  console.error('[E2E] Failed to create seeded database:', error);
  process.exitCode = 1;
});
