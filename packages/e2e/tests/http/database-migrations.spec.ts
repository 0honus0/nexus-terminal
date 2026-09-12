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
  CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE settings_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE proxies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('SOCKS5', 'HTTP')),
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT NULL,
    auth_method TEXT NOT NULL DEFAULT 'none' CHECK(auth_method IN ('none', 'password', 'key')),
    encrypted_password TEXT NULL,
    encrypted_private_key TEXT NULL,
    encrypted_passphrase TEXT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(name, type, host, port)
  );

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

  INSERT INTO settings_migrations (version, name)
  VALUES (8, 'Historical settings schema baseline');

  INSERT INTO settings (key, value)
  VALUES ('ipWhitelistEnabled', 'false');

  INSERT INTO proxies (id, name, type, host, port)
  VALUES (1, 'Historical Proxy', 'SOCKS5', '198.51.100.10', 1080);

  INSERT INTO connections (name, type, host, port, username, auth_method, notes, jump_chain)
  VALUES ('Historical RDP', 'RDP', '192.0.2.88', 3389, 'legacy-user', 'password', 'legacy row', NULL);

  INSERT INTO connections (name, type, host, port, username, auth_method, proxy_id, proxy_type, notes, jump_chain)
  VALUES
    ('Legacy Proxyless SSH', 'SSH', '192.0.2.89', 22, 'legacy-user', 'password', NULL, 'proxy', 'legacy fallback direct row', NULL),
    ('Historical Proxied SSH', 'SSH', '192.0.2.90', 22, 'legacy-user', 'password', 1, 'proxy', 'valid proxy row', NULL);
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
): {
  hasRdpOptions: boolean;
  migrations: Array<{ id: number; name: string }>;
  routes: Array<{ name: string; proxy_id: number | null; proxy_type: string | null }>;
  settingsMigrations: Array<{ version: number; name: string }>;
  ipWhitelistEnabled: string | null;
} => {
  const script = String.raw`
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    try {
      const columns = db.prepare('PRAGMA table_info(connections)').all();
      const migrations = db.prepare('SELECT id, name FROM migrations WHERE id IN (19, 20) ORDER BY id').all();
      const routes = db.prepare("SELECT name, proxy_id, proxy_type FROM connections WHERE name IN ('Legacy Proxyless SSH', 'Historical Proxied SSH') ORDER BY id").all();
      const settingsMigrations = db.prepare('SELECT version, name FROM settings_migrations WHERE version = 9').all();
      const ipWhitelistEnabled = db.prepare("SELECT value FROM settings WHERE key = 'ipWhitelistEnabled'").get()?.value ?? null;
      process.stdout.write(JSON.stringify({
        hasRdpOptions: columns.some((column) => column.name === 'rdp_options'),
        migrations,
        routes,
        settingsMigrations,
        ipWhitelistEnabled,
      }));
    } finally {
      db.close();
    }
  `;
  return JSON.parse(execFileSync(process.execPath, ['-e', script, databasePath], { cwd: repoRoot, encoding: 'utf8' }));
};

test('historical databases apply current connection and settings migrations through normal backend startup', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'nexus-connection-migration-e2e-'));
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
      RP_ID: '127.0.0.1',
      RP_ORIGIN: baseURL,
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
        proxyId?: number | null;
        route?: string | null;
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
      expect(connections).toContainEqual(
        expect.objectContaining({
          name: 'Legacy Proxyless SSH',
          proxyId: null,
          route: null,
        }),
      );
      expect(connections).toContainEqual(
        expect.objectContaining({
          name: 'Historical Proxied SSH',
          proxyId: 1,
          route: 'proxy',
        }),
      );
    } finally {
      await request.dispose();
      await stopProcess(child);
    }

    const upgrade = readUpgradeEvidence(databasePath);
    expect(upgrade.hasRdpOptions).toBeTruthy();
    expect(upgrade.migrations).toEqual([
      { id: 19, name: 'Add RDP options column to connections table' },
      { id: 20, name: 'Normalize legacy proxy routes without proxy references' },
    ]);
    expect(upgrade.routes).toEqual([
      { name: 'Legacy Proxyless SSH', proxy_id: null, proxy_type: null },
      { name: 'Historical Proxied SSH', proxy_id: 1, proxy_type: 'proxy' },
    ]);
    expect(upgrade.settingsMigrations).toEqual([{ version: 9, name: 'Remove ipWhitelistEnabled' }]);
    expect(upgrade.ipWhitelistEnabled).toBeNull();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
