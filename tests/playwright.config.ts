import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';
import path from 'node:path';
import { E2E_PORTS, E2E_URLS } from './support/protocols/test-environment';
import { E2E_ADMIN } from './e2e/support/test-identity';
import { captureWebServerOutput } from './support/protocols/web-server-logs';

const e2eRoot = path.join(import.meta.dirname, 'e2e');
const repoRoot = path.resolve(e2eRoot, '../..');
const artifactRoot = path.resolve(
	process.env.NEXUS_TEST_ARTIFACT_DIR ?? path.join(import.meta.dirname, '.artifacts/browser'),
);
process.env.NEXUS_TEST_ARTIFACT_DIR = artifactRoot;
const htmlReport = {
	open: 'never',
	outputFolder: path.join(artifactRoot, 'reports/playwright'),
};
process.env.NEXUS_E2E_DATA_ROOT ??= path.join(artifactRoot, 'backend', randomBytes(16).toString('hex'));
const testDataDir = path.resolve(process.env.NEXUS_E2E_DATA_ROOT);
process.env.NEXUS_E2E_DATA_ROOT = testDataDir;
// Unix sockets in remote process fixtures must remain distinct below sockaddr_un's
// path capacity. Keep runtime paths short independently of the evidence root.
process.env.NEXUS_E2E_SERVICE_ROOT ??= path.join(
	tmpdir(),
	'nx-ssh-' + createHash('sha256').update(testDataDir).digest('hex').slice(0, 12),
);
process.env.NEXUS_E2E_DESKTOP_ROOT ??= path.join(testDataDir, 'desktop');
process.env.NEXUS_E2E_CONTROL_TOKEN ??= randomBytes(32).toString('hex');
const isCI = Boolean(process.env.CI);
const inheritedEnv = Object.fromEntries(
	Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
);
const pnpmCommand = process.env.NEXUS_E2E_PNPM_COMMAND ?? 'pnpm';
const webServerLogs = path.join(artifactRoot, 'webserver');

const backendEnv: Record<string, string> = {
	...inheritedEnv,
	NODE_ENV: 'test',
	NEXUS_E2E_BACKEND_PORT: String(E2E_PORTS.backend),
	NEXUS_E2E_BACKEND_CONTROL_PORT: String(E2E_PORTS.backendControl),
	NEXUS_E2E_DATA_ROOT: testDataDir,
	NEXUS_E2E_ADMIN_USERNAME: E2E_ADMIN.username,
	NEXUS_E2E_ADMIN_PASSWORD: E2E_ADMIN.password,
	NEXUS_VITE_BACKEND_ORIGIN: E2E_URLS.backendOrigin,
	NEXUS_PUBLIC_ORIGIN: E2E_URLS.frontendOrigin,
};

export default defineConfig({
	testDir: './e2e/specs',
	testIgnore: ['**/ingress/**'],
	outputDir: path.join(artifactRoot, 'results'),
	fullyParallel: false,
	forbidOnly: isCI,
	// Run the full selected suite even when earlier tests fail; CI reports failure only after all results are collected.
	maxFailures: 0,
	workers: 1,
	retries: isCI ? 1 : 0,
	failOnFlakyTests: isCI,
	globalTimeout: isCI ? 15 * 60_000 : 0,
	timeout: 120_000,
	expect: { timeout: 10_000 },
	reporter: isCI
		? [[path.join(e2eRoot, 'support/mirrored-log-reporter.ts')], ['github'], ['html', htmlReport]]
		: [[path.join(e2eRoot, 'support/mirrored-log-reporter.ts')], ['list'], ['html', htmlReport]],
	use: {
		actionTimeout: 15_000,
		navigationTimeout: 30_000,
		baseURL: E2E_URLS.frontendOrigin,
		permissions: ['clipboard-read', 'clipboard-write'],
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			testMatch: '**/*.spec.{ts,mjs}',
			testIgnore: ['**/*.mobile.spec.ts', '**/ingress/**'],
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'touch-mobile',
			testMatch: '**/*.mobile.spec.ts',
			use: { ...devices['Pixel 7'] },
		},
	],
	webServer: [
		{
			command: captureWebServerOutput('node support/backend-server.mjs', path.join(webServerLogs, 'backend')),
			cwd: e2eRoot,
			env: backendEnv,
			url: `${E2E_URLS.backendControlOrigin}/health`,
			reuseExistingServer: false,
			timeout: 120_000,
			stdout: 'pipe',
			stderr: 'pipe',
		},
		{
			command: captureWebServerOutput(
				`${pnpmCommand} run preview --host 127.0.0.1 --port ${E2E_PORTS.frontend} --strictPort`,
				path.join(webServerLogs, 'frontend'),
			),
			cwd: path.join(repoRoot, 'packages/frontend'),
			env: {
				...backendEnv,
			},
			url: `${E2E_URLS.frontendLoopbackOrigin}/login`,
			reuseExistingServer: false,
			timeout: 120_000,
			stdout: 'pipe',
			stderr: 'pipe',
		},
	] satisfies NonNullable<PlaywrightTestConfig['webServer']>,
});
