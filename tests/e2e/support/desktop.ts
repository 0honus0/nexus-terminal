import { expect, type Page } from './fixtures';
import { E2E_URLS } from './test-env';

export async function observeDesktopBinaryTraffic(page: Page): Promise<() => Promise<void>> {
	let receivedBinary = 0;
	let receivedText = 0;
	page.on('websocket', (socket) => {
		if (new URL(socket.url()).pathname !== '/ws/remote-desktop') return;
		socket.on('framereceived', ({ payload }) => {
			if (typeof payload === 'string') receivedText++;
			else if (payload.byteLength > 0) receivedBinary++;
		});
	});
	// Observe the real native send call as well as incoming frames; CDP alone did
	// not report outgoing binary data in the authenticated RDP run. Store only counts.
	await page.addInitScript(() => {
		const counts = { binary: 0, text: 0 };
		Object.defineProperty(window, '__nexusDesktopSendCounts', { value: counts });
		const send = WebSocket.prototype.send;
		WebSocket.prototype.send = function (data) {
			const result = send.call(this, data);
			if (new URL(this.url).pathname === '/ws/remote-desktop') {
				if (typeof data === 'string') counts.text++;
				else if (data instanceof Blob ? data.size > 0 : data.byteLength > 0) counts.binary++;
			}
			return result;
		};
	});
	return async () => {
		const sent = await page.evaluate(() => {
			const counts: unknown = Reflect.get(window, '__nexusDesktopSendCounts');
			if (
				!counts ||
				typeof counts !== 'object' ||
				!('binary' in counts) ||
				typeof counts.binary !== 'number' ||
				!('text' in counts) ||
				typeof counts.text !== 'number'
			) {
				throw new Error('Desktop send observation is missing');
			}
			return { binary: counts.binary, text: counts.text };
		});
		expect(sent.binary).toBeGreaterThan(0);
		expect(sent.text).toBe(0);
		expect(receivedBinary).toBeGreaterThan(0);
		expect(receivedText).toBe(0);
	};
}

export async function authenticateTestRdp(page: Page): Promise<void> {
	const endpoint = E2E_URLS.desktopControlOrigin + '/e2e/desktop/rdp-authentication';

	const readAuthenticatedSessions = async () => {
		const response = await page.request.get(endpoint);
		expect(response.ok()).toBe(true);
		const value: unknown = await response.json();
		if (
			!value ||
			typeof value !== 'object' ||
			!('authenticatedSessions' in value) ||
			typeof value.authenticatedSessions !== 'number'
		) {
			throw new Error('Invalid desktop authentication evidence');
		}
		return value.authenticatedSessions;
	};

	const before = await readAuthenticatedSessions();
	const display = page.locator('.remote-display-container');
	const canvas = display.locator('canvas');
	await expect
		.poll(() =>
			canvas.evaluate((element) => {
				if (!(element instanceof HTMLCanvasElement)) return false;
				const context = element.getContext('2d');
				return Boolean(
					context &&
					context.getImageData(Math.floor(element.width / 2), Math.floor(element.height / 2), 1, 1).data[3],
				);
			}),
		)
		.toBe(true);
	const keyboard = page.locator('.remote-desktop-panel textarea');
	await keyboard.dispatchEvent('keydown', { key: 'Enter', code: 'Enter' });
	await keyboard.dispatchEvent('keyup', { key: 'Enter', code: 'Enter' });
	await expect.poll(readAuthenticatedSessions).toBe(before + 1);
}
