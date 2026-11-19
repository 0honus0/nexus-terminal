import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173';

export default defineConfig({
	testDir: './browser',
	outputDir: '../test-results',
	use: { baseURL, locale: 'en-US', trace: 'retain-on-failure' },
	webServer: {
		command: 'pnpm start:frontend --config tests/vite.browser.config.ts --host 127.0.0.1 --port 4173 --strictPort',
		url: baseURL,
	},
});
