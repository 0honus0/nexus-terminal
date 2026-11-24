import { isIP } from 'node:net';
import { defineConfig } from '@playwright/test';

const cdp = process.env.NEXUS_TEST_CDP;
const localOrigin = 'http://127.0.0.1:4173';
if (cdp && !process.env.NEXUS_TEST_CDP_ORIGIN) throw new Error('NEXUS_TEST_CDP_ORIGIN is required');
const origin = new URL(cdp ? process.env.NEXUS_TEST_CDP_ORIGIN! : localOrigin);
if (cdp && (origin.protocol !== 'http:' || isIP(origin.hostname) !== 4 || !origin.port))
	throw new Error('NEXUS_TEST_CDP_ORIGIN must be an HTTP IPv4 address and explicit port');

export default defineConfig({
	testDir: './browser',
	// Remote Chrome can reach the isolated Vite fixture server, not the runner's loopback backend.
	testMatch: cdp ? 'plugin-host.spec.ts' : undefined,
	workers: cdp ? 1 : undefined,
	outputDir: '../test-results',
	use: { baseURL: origin.origin, locale: 'en-US', trace: 'retain-on-failure' },
	webServer: {
		command: `pnpm start:frontend --config tests/vite.browser.config.ts --host ${origin.hostname} --port ${origin.port} --strictPort`,
		url: origin.origin,
	},
});
