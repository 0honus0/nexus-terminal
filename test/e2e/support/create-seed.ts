import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_ADMIN } from './test-identity';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const e2eRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(e2eRoot, '../..');
const backendRoot = path.join(repoRoot, 'packages', 'backend');
const seedDir = path.join(e2eRoot, 'fixtures', 'seeded-data');
const seedDbPath = path.join(seedDir, 'nexus-terminal.db');
const tsxCli = path.join(backendRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const port = 31091;
const baseUrl = `http://127.0.0.1:${port}`;

const backendEnv: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: String(port),
  NEXUS_DATA_DIR: seedDir,
  NEXUS_E2E_RESET_ENABLED: '0',
  SESSION_COOKIE_NAME: 'nexus.seed.sid',
  SESSION_SECRET: 'e2e-seed-session-secret-do-not-use-outside-tests-000000000000000000000000',
  ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  REMOTE_GATEWAY_SHARED_SECRET: 'e2e-seed-remote-gateway-shared-secret-do-not-use-outside-tests',
  DEPLOYMENT_MODE: 'local',
  REMOTE_GATEWAY_API_BASE_LOCAL: 'http://127.0.0.1:29090',
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitForBackend = async (child: ChildProcess): Promise<void> => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Backend exited before seed setup (code ${child.exitCode}).`);
    try {
      const response = await fetch(`${baseUrl}/api/v1/auth/needs-setup`);
      if (response.ok) return;
    } catch {
      // Backend is still starting.
    }
    await sleep(100);
  }
  throw new Error('Timed out waiting for Backend while creating the E2E seed.');
};

const stopBackend = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    sleep(10_000).then(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }),
  ]);
};

async function main(): Promise<void> {
  fs.rmSync(seedDir, { recursive: true, force: true });
  fs.mkdirSync(seedDir, { recursive: true });
  if (!fs.existsSync(tsxCli)) {
    throw new Error(`Backend tsx runtime is missing: ${tsxCli}. Run npm install for packages/backend first.`);
  }

  const output: string[] = [];
  const child = spawn(process.execPath, [tsxCli, 'src/index.ts'], {
    cwd: backendRoot,
    env: backendEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => output.push(String(chunk)));
  child.stderr?.on('data', (chunk) => output.push(String(chunk)));

  try {
    await waitForBackend(child);
    const setup = await fetch(`${baseUrl}/api/v1/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: E2E_ADMIN.username,
        password: E2E_ADMIN.password,
        confirmPassword: E2E_ADMIN.password,
      }),
    });
    if (setup.status !== 201) {
      throw new Error(`Backend setup returned ${setup.status}: ${await setup.text()}`);
    }
  } catch (error) {
    if (output.length) console.error(output.join('').slice(-10_000));
    throw error;
  } finally {
    await stopBackend(child);
  }

  if (!fs.existsSync(seedDbPath)) throw new Error(`Backend setup did not create ${seedDbPath}`);
  for (const entry of fs.readdirSync(seedDir)) {
    if (entry === 'nexus-terminal.db') continue;
    fs.rmSync(path.join(seedDir, entry), { recursive: true, force: true });
  }
  console.log(`[E2E] Wrote seeded database through /api/v1/auth/setup: ${seedDbPath}`);
}

void main().catch((error) => {
  console.error('[E2E] Failed to create seeded database:', error);
  process.exitCode = 1;
});
