import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { E2E_PORTS, E2E_URLS } from './support/test-env';
import { E2E_ADMIN } from './support/test-identity';

const e2eRoot = __dirname;
const repoRoot = path.resolve(e2eRoot, '../..');
const testDataDir = path.join(e2eRoot, '.tmp', 'backend-data');
process.env.NEXUS_E2E_CONTROL_TOKEN ??= randomBytes(32).toString('hex');
const isCI = Boolean(process.env.CI);
const e2ePluginPrivateKeyPem = readFileSync(
	path.join(e2eRoot, 'fixtures', 'agent', 'keys', 'official-e2e-private.pem'),
	'utf8',
);
const inheritedEnv = Object.fromEntries(
	Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
);
const pnpmCommand = process.env.NEXUS_E2E_PNPM_COMMAND ?? 'pnpm';

const pluginRepositoryEnv: Record<string, string> = {
	...inheritedEnv,
	NEXUS_E2E_PLUGIN_SIGNING_KEY_PEM: e2ePluginPrivateKeyPem,
};

const backendEnv: Record<string, string> = {
	...inheritedEnv,
	NODE_ENV: 'test',
	NEXUS_E2E_BACKEND_PORT: String(E2E_PORTS.backend),
	NEXUS_E2E_BACKEND_CONTROL_PORT: String(E2E_PORTS.backendControl),
	NEXUS_E2E_DATA_ROOT: testDataDir,
	NEXUS_E2E_ADMIN_USERNAME: E2E_ADMIN.username,
	NEXUS_E2E_ADMIN_PASSWORD: E2E_ADMIN.password,
	GUACD_HOST: '127.0.0.1',
	GUACD_PORT: String(E2E_PORTS.guacd),
	NEXUS_VITE_BACKEND_ORIGIN: E2E_URLS.backendOrigin,
	NEXUS_PUBLIC_ORIGIN: E2E_URLS.frontendOrigin,
};

export default defineConfig({
	testDir: './specs',
	fullyParallel: false,
	// Run the full selected suite even when earlier tests fail; CI reports failure only after all results are collected.
	maxFailures: 0,
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
			command: 'node fixtures/agent/deployment-page.mjs',
			cwd: e2eRoot,
			env: { ...inheritedEnv, NEXUS_E2E_DEPLOYMENT_PAGE_PORT: String(E2E_PORTS.deploymentPage) },
			url: `${E2E_URLS.deploymentPageOrigin}/state`,
			reuseExistingServer: false,
			timeout: 30_000,
			stdout: 'pipe',
			stderr: 'pipe',
		},
		{
			command: 'node support/test-browser-server.mjs',
			cwd: e2eRoot,
			env: {
				...inheritedEnv,
				NEXUS_E2E_BROWSER_CONTROL_PORT: String(E2E_PORTS.browserControl),
				NEXUS_E2E_BROWSER_CDP_PORT: String(E2E_PORTS.browserCdp),
			},
			url: `${E2E_URLS.browserControlOrigin}/contexts`,
			reuseExistingServer: false,
			timeout: 30_000,
			stdout: 'pipe',
			stderr: 'pipe',
		},
		{
			command: 'node fixtures/agent/openai-provider.mjs',
			cwd: e2eRoot,
			env: inheritedEnv,
			url: `${E2E_URLS.openAiProviderOrigin}/health`,
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
			command: `${pnpmCommand} --filter @nexus-terminal/backend build && node support/backend-server.mjs`,
			cwd: e2eRoot,
			env: backendEnv,
			url: `${E2E_URLS.backendControlOrigin}/health`,
			reuseExistingServer: false,
			timeout: 120_000,
			stdout: 'pipe',
			stderr: 'pipe',
		},
		{
			command: `${pnpmCommand} run dev --host 127.0.0.1 --port ${E2E_PORTS.frontend} --strictPort`,
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
