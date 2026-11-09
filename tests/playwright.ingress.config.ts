import { defineConfig } from '@playwright/test';
import path from 'node:path';

const baseURL = process.env.NEXUS_PRODUCTION_BASE_URL;

if (!baseURL) {
	throw new Error('NEXUS_PRODUCTION_BASE_URL must be set for production ingress E2E tests.');
}
const artifactRoot = path.resolve(
	process.env.NEXUS_TEST_ARTIFACT_DIR ?? path.join(import.meta.dirname, '.artifacts/ingress'),
);
process.env.NEXUS_TEST_ARTIFACT_DIR = artifactRoot;
const htmlReport = { open: 'never', outputFolder: path.join(artifactRoot, 'reports/playwright') };

export default defineConfig({
	testDir: './e2e/specs/ingress',
	outputDir: path.join(artifactRoot, 'results'),
	forbidOnly: Boolean(process.env.CI),
	failOnFlakyTests: Boolean(process.env.CI),
	fullyParallel: false,
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	failOnFlakyTests: Boolean(process.env.CI),
	timeout: 30_000,
	expect: { timeout: 10_000 },
	reporter: process.env.CI
		? [['./e2e/support/mirrored-log-reporter.ts'], ['github'], ['html', htmlReport]]
		: [['./e2e/support/mirrored-log-reporter.ts'], ['list'], ['html', htmlReport]],
	use: {
		baseURL,
		trace: 'retain-on-failure',
	},
});
