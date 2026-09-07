import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { request as playwrightRequest } from '@playwright/test';
import { ensureInitialAdmin, loginAsInitialAdmin } from '../../support/auth';
import { expect, test } from '../../support/fixtures';

const e2eRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(e2eRoot, '../..');
const backendRoot = path.join(repoRoot, 'packages', 'backend');
const tsxBin = path.join(backendRoot, 'node_modules', '.bin', 'tsx');
const ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const reservePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to reserve an E2E backend port.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

const stopProcess = async (child: ChildProcessWithoutNullStreams): Promise<void> => {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
        resolve();
      }, 5_000),
    ),
  ]);
};

const waitForBackend = async (
  baseURL: string,
  child: ChildProcessWithoutNullStreams,
  logs: () => string,
): Promise<void> => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Historical migration backend exited with ${child.exitCode}.\n${logs()}`);
    }
    try {
      const response = await fetch(`${baseURL}/api/v1/auth/needs-setup`);
      if (response.ok) return;
    } catch {
      // Startup has not opened the HTTP listener yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Historical migration backend did not become ready.\n${logs()}`);
};

const HISTORICAL_DATABASE_SQL = `
  CREATE TABLE connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NULL,
    type TEXT NOT NULL DEFAULT 'SSH',
    host TEXT NOT NULL,
    port INTEGER NULL,
    username TEXT NULL,
    auth_method TEXT NULL,
    encrypted_password TEXT NULL,
    encrypted_private_key TEXT NULL,
    encrypted_passphrase TEXT NULL,
    proxy_id INTEGER NULL,
    proxy_type TEXT NULL,
    ssh_key_id INTEGER NULL,
    notes TEXT NULL,
    jump_chain TEXT NULL,
    force_keyboard_interactive INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    last_connected_at INTEGER NULL
  );

  CREATE TABLE connection_tags (
    connection_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL
  );

  CREATE TABLE migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  INSERT INTO migrations (id, name) VALUES
    (11, 'Add force_keyboard_interactive column to connections table'),
    (18, 'Fix Telnet CHECK constraint and add missing FK indexes');

  INSERT INTO connections (name, type, host, port, username, auth_method, notes, jump_chain)
  VALUES ('Historical RDP', 'RDP', '192.0.2.88', 3389, 'legacy-user', 'password', 'legacy row', NULL);
`;

const createHistoricalDatabase = (databasePath: string): void => {
  const script = `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.argv[1]);
    try {
      db.exec(${JSON.stringify(HISTORICAL_DATABASE_SQL)});
    } finally {
      db.close();
    }
  `;
  execFileSync(process.execPath, ['-e', script, databasePath], { cwd: repoRoot, stdio: 'pipe' });
};

const readUpgradeEvidence = (
  databasePath: string,
): { hasRdpOptions: boolean; migration: { id: number; name: string } | null } => {
  const script = String.raw`
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    try {
      const columns = db.prepare('PRAGMA table_info(connections)').all();
      const migration = db.prepare('SELECT id, name FROM migrations WHERE id = 19').get() ?? null;
      process.stdout.write(JSON.stringify({
        hasRdpOptions: columns.some((column) => column.name === 'rdp_options'),
        migration,
      }));
    } finally {
      db.close();
    }
  `;
  return JSON.parse(execFileSync(process.execPath, ['-e', script, databasePath], { cwd: repoRoot, encoding: 'utf8' }));
};

test('historical migration ids still apply the RDP options upgrade through normal backend startup', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'nexus-rdp-migration-e2e-'));
  const databasePath = path.join(dataDir, 'nexus-terminal.db');
  createHistoricalDatabase(databasePath);
  const port = await reservePort();
  const baseURL = `http://127.0.0.1:${port}`;
  let output = '';

  const child = spawn(tsxBin, ['src/index.ts'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      NODE_ENV: 'test',
      NEXUS_DATA_DIR: dataDir,
      NEXUS_E2E_RESET_ENABLED: '0',
      SESSION_COOKIE_NAME: 'nexus.migration.e2e.sid',
      SESSION_SECRET: 'migration-e2e-session-secret-do-not-use-outside-tests-0000000000000000',
      ENCRYPTION_KEY,
      REMOTE_GATEWAY_SHARED_SECRET: 'migration-e2e-remote-gateway-secret-do-not-use-outside-tests',
      DEPLOYMENT_MODE: 'local',
      RP_ID: '127.0.0.1',
      RP_ORIGIN: baseURL,
      REMOTE_GATEWAY_API_BASE_LOCAL: 'http://127.0.0.1:29090',
      REMOTE_GATEWAY_WS_URL_LOCAL: 'ws://127.0.0.1:29090',
    },
    stdio: 'pipe',
  });
  child.stdin.end();
  child.stdout.on('data', (chunk) => {
    output = `${output}${String(chunk)}`.slice(-20_000);
  });
  child.stderr.on('data', (chunk) => {
    output = `${output}${String(chunk)}`.slice(-20_000);
  });

  const request = await playwrightRequest.newContext({ baseURL });
  try {
    try {
      await waitForBackend(baseURL, child, () => output);
      await ensureInitialAdmin(request);
      await loginAsInitialAdmin(request);

      const response = await request.get('/api/v1/connections');
      expect(response.ok(), output).toBeTruthy();
      const connections = (await response.json()) as Array<{
        name: string | null;
        type: string;
        host: string;
        rdpOptions?: unknown;
      }>;
      expect(connections).toContainEqual(
        expect.objectContaining({
          name: 'Historical RDP',
          type: 'RDP',
          host: '192.0.2.88',
          rdpOptions: null,
        }),
      );
    } finally {
      await request.dispose();
      await stopProcess(child);
    }

    const upgrade = readUpgradeEvidence(databasePath);
    expect(upgrade.hasRdpOptions).toBeTruthy();
    expect(upgrade.migration).toEqual({ id: 19, name: 'Add RDP options column to connections table' });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
