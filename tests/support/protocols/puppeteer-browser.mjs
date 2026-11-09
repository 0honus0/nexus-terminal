import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { once } from 'node:events';

const backend = createRequire(new URL('../../../packages/backend/package.json', import.meta.url));
const puppeteer = backend('puppeteer-core');

// Let Playwright select its installed headless browser through its public API.
// Puppeteer still exercises the product's real CDP adapter against that browser.
export async function openPuppeteerBrowser() {
	const reservation = createServer();
	reservation.listen(0, '127.0.0.1');
	await once(reservation, 'listening');
	const port = reservation.address().port;
	await new Promise((resolve, reject) => reservation.close((error) => (error ? reject(error) : resolve())));
	const process = await chromium.launch({ args: ['--remote-debugging-port=' + port, '--no-sandbox'] });
	try {
		const response = await fetch(`http://127.0.0.1:${port}/json/version`);
		if (!response.ok) throw new Error('Test browser CDP discovery failed');
		const discovery = await response.json();
		const browser = await puppeteer.connect({ browserWSEndpoint: discovery.webSocketDebuggerUrl });
		return {
			browser,

			async close() {
				try {
					await browser.disconnect();
				} finally {
					await process.close();
				}
			},
		};
	} catch (cause) {
		try {
			await process.close();
		} catch (cleanup) {
			throw new AggregateError([cause, cleanup], 'Test browser construction cleanup failed');
		}
		throw cause;
	}
}
