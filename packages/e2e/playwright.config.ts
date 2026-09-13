import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { E2E_PORTS, E2E_URLS } from './support/test-env';

const e2eRoot = __dirname;
const repoRoot = path.resolve(e2eRoot, '../..');
const testDataDir = path.join(e2eRoot, '.tmp', 'backend-data');
const seedDbPath = path.join(e2eRoot, 'fixtures', 'seeded-data', 'nexus-terminal.db');
const prepareTestDataScript = path.join(e2eRoot, 'support', 'prepare-test-data.mjs');
const isCI = Boolean(process.env.CI);
const e2ePluginPrivateKeyPem = readFileSync(
  path.join(e2eRoot, 'fixtures', 'agent', 'keys', 'official-e2e-private.pem'),
  'utf8',
);
const e2ePluginPublicKeyPem = readFileSync(
  path.join(e2eRoot, 'fixtures', 'agent', 'keys', 'official-e2e-public.pem'),
  'utf8',
);
const e2ePluginPublisherKeyId = `ed25519:${createHash('sha256')
  .update(createPublicKey(e2ePluginPublicKeyPem).export({ type: 'spki', format: 'der' }))
  .digest('hex')}`;

const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
);

const pluginRepositoryEnv: Record<string, string> = {
  ...inheritedEnv,
  NEXUS_E2E_PLUGIN_SIGNING_KEY_PEM: e2ePluginPrivateKeyPem,
};

const backendEnv: Record<string, string> = {
  ...inheritedEnv,
  NODE_ENV: 'test',
  PORT: String(E2E_PORTS.backend),
  NEXUS_DATA_DIR: testDataDir,
  NEXUS_E2E_RESET_ENABLED: '1',
  NEXUS_E2E_SEED_DB: seedDbPath,
  SESSION_COOKIE_NAME: 'nexus.e2e.sid',
  SESSION_SECRET: 'e2e-session-secret-do-not-use-outside-tests-000000000000000000000000',
  ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  RP_ID: 'localhost',
  RP_ORIGIN: E2E_URLS.frontendOrigin,
  GUACD_HOST: '127.0.0.1',
  GUACD_PORT: String(E2E_PORTS.guacd),
  NEXUS_VITE_BACKEND_ORIGIN: E2E_URLS.backendOrigin,
  AGENT_PUBLIC_ORIGIN: E2E_URLS.frontendOrigin,
  AGENT_PLUGIN_FRONTEND_ORIGIN: E2E_URLS.pluginFrontendOrigin,
  AGENT_PLUGIN_FRONTEND_PORT: String(E2E_PORTS.pluginFrontend),
  AGENT_OFFICIAL_PLUGIN_CATALOG_URL: `${E2E_URLS.pluginRepositoryOrigin}/catalog.json`,
  AGENT_OFFICIAL_PLUGIN_PUBLISHER_KEY_ID: e2ePluginPublisherKeyId,
  AGENT_OFFICIAL_PLUGIN_PUBLISHER_PUBLIC_KEY_PEM: e2ePluginPublicKeyPem,
  AGENT_OFFICIAL_PLUGIN_PRIVATE_HOST_EXCEPTIONS: `127.0.0.1:${E2E_PORTS.pluginRepository}`,
};

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,
  globalTimeout: isCI ? 15 * 60_000 : 0,
  timeout: isCI ? 120_000 : 0,
  expect: { timeout: 10_000 },
  reporter: isCI
    ? [['./support/mirrored-log-reporter.ts'], ['github'], ['html', { open: 'never' }]]
    : [['./support/mirrored-log-reporter.ts'], ['list'], ['html', { open: 'never' }]],
  use: {
    actionTimeout: isCI ? 15_000 : 0,
    navigationTimeout: isCI ? 30_000 : 0,
    baseURL: E2E_URLS.frontendOrigin,
    permissions: ['clipboard-read', 'clipboard-write'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'auth',
      testMatch: /auth\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'http',
      testMatch: /http\/.*\.spec\.ts/,
    },
    {
      name: 'agent',
      testMatch: /agent\/.*\.spec\.ts/,
    },
    {
      name: 'websocket',
      testMatch: /websocket\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'ui',
      testMatch: /ui\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'ssh',
      testMatch: /ssh\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testMatch: /mobile\/.*\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: [
    {
      command: 'node fixtures/agent/openai-provider.mjs',
      cwd: e2eRoot,
      url: 'http://127.0.0.1:29091/health',
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'node fixtures/agent/plugin-repository.mjs',
      cwd: e2eRoot,
      env: pluginRepositoryEnv,
      url: `${E2E_URLS.pluginRepositoryOrigin}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'node support/test-guacd-server.mjs',
      cwd: e2eRoot,
      url: `${E2E_URLS.guacdControlOrigin}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'node support/test-ssh-server.mjs',
      cwd: e2eRoot,
      url: `${E2E_URLS.sshControlOrigin}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `node ${JSON.stringify(prepareTestDataScript)} && pnpm exec tsx src/index.ts`,
      cwd: path.join(repoRoot, 'packages/backend'),
      env: backendEnv,
      url: `${E2E_URLS.backendOrigin}/api/v1/auth/needs-setup`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `pnpm run dev --host 127.0.0.1 --port ${E2E_PORTS.frontend} --strictPort`,
      cwd: path.join(repoRoot, 'packages/frontend'),
      env: {
        ...backendEnv,
        NEXUS_VITE_CACHE_DIR: path.join(e2eRoot, '.tmp', 'vite-cache'),
      },
      url: `${E2E_URLS.frontendLoopbackOrigin}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
