import { defineConfig } from '@playwright/test';

const baseURL = process.env.NEXUS_PRODUCTION_BASE_URL;

if (!baseURL) {
	throw new Error('NEXUS_PRODUCTION_BASE_URL must be set for production ingress E2E tests.');
}

export default defineConfig({
	testDir: './e2e/specs/ingress',
	fullyParallel: false,
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	failOnFlakyTests: Boolean(process.env.CI),
	timeout: 30_000,
	expect: { timeout: 10_000 },
	reporter: process.env.CI
		? [['./e2e/support/mirrored-log-reporter.ts'], ['github'], ['html', { open: 'never' }]]
		: [['./e2e/support/mirrored-log-reporter.ts'], ['list'], ['html', { open: 'never' }]],
	use: {
		baseURL,
		trace: 'retain-on-failure',
	},
});
