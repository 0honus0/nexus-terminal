import assert from 'node:assert/strict';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../packages/frontend/node_modules/vite/dist/node/index.js';
import { createApp } from '../../packages/backend/dist/bootstrap/create-app.js';
import { openDesktopServices, waitFor } from '../backend/remote/desktop-fixture.mjs';

const { chromium } = createRequire(new URL('../e2e/package.json', import.meta.url))('@playwright/test');
const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-desktop-page-'));
let services;
let app;
let vite;
let browser;
try {
	services = await openDesktopServices();
	const reservation = createNetServer();
	await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
	const port = reservation.address().port;
	await new Promise((resolve, reject) => reservation.close((cause) => (cause ? reject(cause) : resolve())));
	const origin = 'http://127.0.0.1:' + port;
	app = await createApp(join(directory, 'desktop.db'), {
		encryptionKey: randomBytes(32),
		guacd: { host: '127.0.0.1', port: services.port },
	});
	const backend = await app.listenHttp({
		publicOrigin: origin,
		bindHost: '127.0.0.1',
		port: 0,
		trustedProxies: ['loopback'],
	});
	vite = await createServer({
		root: fileURLToPath(new URL('../../packages/frontend', import.meta.url)),
		configFile: fileURLToPath(new URL('../../packages/frontend/vite.config.ts', import.meta.url)),
		cacheDir: join(directory, 'vite-cache'),
		logLevel: 'error',
		server: {
			host: '127.0.0.1',
			port,
			strictPort: true,
			proxy: {
				'/api': { target: 'http://' + backend, changeOrigin: false },
				'/ws/remote-desktop': { target: 'ws://' + backend, changeOrigin: false, ws: true },
			},
		},
		plugins: [
			{
				name: 'desktop-fixture',

				resolveId(id) {
					if (id === 'virtual:desktop-fixture') return '\0virtual:desktop-fixture';
				},

				load(id) {
					if (id === '\0virtual:desktop-fixture')
						return `
					export {createApp, h, nextTick, ref} from 'vue';
					export {readRemoteDesktopSessionResponse, readRemoteDesktopFailureResponse} from '@nexus-terminal/shared/remote/desktop/http-codec';
				`;
				},

				configureServer(server) {
					server.middlewares.use('/__desktop', (_request, response) => {
						response.setHeader('Content-Type', 'text/html');
						response.end('<!doctype html><title>Desktop fixture</title>');
					});
				},
			},
		],
	});
	await vite.listen();
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
	const errors = [];
	let networkChanges = 0;
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') console.error('Browser:', message.text());
	});
	page.on('requestfailed', (request) => {
		if (request.failure()?.errorText === 'net::ERR_NETWORK_CHANGED') networkChanges += 1;
	});
	await page.goto(origin + '/__desktop');
	const ids = await page.evaluate(async () => {
		for (const action of ['setup', 'login']) {
			const response = await fetch('/api/v1/auth/' + action, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(
					action === 'setup'
						? { username: 'admin', password: 'desktop-fixture-123', confirmPassword: 'desktop-fixture-123' }
						: { username: 'admin', password: 'desktop-fixture-123' },
				),
			});
			if (!response.ok) throw Error(action + ' failed: ' + response.status);
		}
		const ids = {};
		for (const type of ['RDP', 'VNC']) {
			const response = await fetch('/api/v1/targets/connections', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					name: 'Frontend ' + type,
					type,
					host: 'desktop',
					port: type === 'RDP' ? 3389 : 5900,
					username: 'test',
					route: 'direct',
					proxyId: null,
					notes: null,
					rdpRemoteApp: null,
					rdpRemoteAppDirectory: null,
					rdpRemoteAppArguments: null,
					tagIds: [],
					jumpIds: [],
				}),
			});
			if (response.status !== 201) throw Error('create target ' + response.status);
			const target = await response.json();
			const result = await fetch('/api/v1/targets/connections/' + target.id + '/credential', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					version: target.version,
					credential: { kind: 'password', password: 'b10-pass' },
				}),
			});
			if (result.status !== 200) throw Error('create credential');
			ids[type] = target.id;
		}
		return ids;
	});
	// Docker bridge changes can invalidate Chromium's initial module requests.
	// Only this read-only navigation may restart; setup and mutations never replay.
	for (let attempt = 0; ; attempt += 1) {
		const previousChanges = networkChanges;
		await page.goto(origin + '/');
		try {
			await page.getByRole('button', { name: 'Connect Frontend VNC', exact: true }).waitFor({ timeout: 15000 });
			break;
		} catch (cause) {
			if (attempt >= 2 || previousChanges === networkChanges) throw cause;
			if (
				errors.some(
					(error) => !error.startsWith('Failed to fetch dynamically imported module: ' + origin + '/'),
				)
			) {
				throw cause;
			}
			console.log('Restarting read-only initial navigation after Chromium network change');
			errors.length = 0;
		}
	}
	const tickets = [];
	const sockets = [];
	const ticketReads = new Set();
	page.on('response', (response) => {
		if (!/\/(vnc|rdp)-session\?/.test(response.url()) || response.status() !== 200) return;
		const task = response
			.json()
			.then((value) => tickets.push(value.ticket))
			.finally(() => ticketReads.delete(task));
		ticketReads.add(task);
		void task.catch(() => undefined);
	});
	page.on('websocket', (socket) => {
		if (socket.url().includes('/ws/remote-desktop')) {
			const record = { socket, closed: false, frames: [] };
			sockets.push(record);
			socket.on('close', () => {
				record.closed = true;
			});
			socket.on('framesent', ({ payload }) => {
				record.frames.push(payload);
			});
		}
	});
	const checks = [];
	for (const protocol of ['VNC', 'RDP']) {
		await page.getByRole('button', { name: 'Connect Frontend ' + protocol, exact: true }).click();
		const modal = page.getByRole('dialog', { name: 'Frontend ' + protocol, exact: true });
		await modal.waitFor();
		await page.waitForFunction(() => {
			const display = document.querySelector('.remote-display-container');
			return (
				display &&
				[...display.querySelectorAll('canvas')].some(
					(canvas) =>
						canvas.width >= 800 &&
						canvas.height >= 600 &&
						canvas
							.getContext('2d')
							.getImageData(0, 0, canvas.width, canvas.height)
							.data.some((value, index) => index % 4 !== 3 && value > 0),
				)
			);
		});
		await modal.getByText('Connected', { exact: true }).first().waitFor();
		await waitFor(
			() => services.connections(),
			(count) => count === 1,
			'One real desktop transport',
			20000,
		);
		checks.push(
			protocol + ' formal Dashboard opens the actual App desktop modal and receives real nonblank pixels',
		);

		const width = modal.locator(protocol === 'VNC' ? '#vnc-modal-width' : '#rdp-modal-width');
		const height = modal.locator(protocol === 'VNC' ? '#vnc-modal-height' : '#rdp-modal-height');
		let releaseSize;
		let sizeStarted = false;
		const sizeGate = new Promise((resolve) => {
			releaseSize = resolve;
		});

		const holdSize = async (route) => {
			if (route.request().method() !== 'PUT') return route.continue();
			sizeStarted = true;
			await sizeGate;
			await route.continue();
		};

		await page.route('**/api/v1/settings/preferences', holdSize);
		await width.fill('900');
		await width.press('Tab');
		try {
			await waitFor(() => Promise.resolve(sizeStarted), Boolean, 'Actual size persistence started', 15000);
			assert.equal(await height.isDisabled(), true);
			assert.equal(await modal.locator('[data-ui="resize-handle"]').isDisabled(), true);
		} finally {
			releaseSize();
		}
		await height.fill('700');
		await height.press('Tab');
		await page.unroute('**/api/v1/settings/preferences', holdSize);
		await page.waitForFunction(() => {
			const node = document.querySelector('.remote-desktop-panel');
			return (
				Math.round(node.getBoundingClientRect().width) === 900 &&
				Math.round(node.getBoundingClientRect().height) === 700
			);
		});
		const originalSocket = sockets.at(-1);
		await modal.getByRole('button', { name: 'Minimize', exact: true }).click();
		await modal.waitFor({ state: 'hidden' });
		assert.equal(originalSocket.closed, false);
		await page.getByRole('button', { name: 'Restore remote desktop window', exact: true }).click();
		await modal.waitFor();
		assert.equal(originalSocket.closed, false);
		await modal.getByRole('button', { name: 'Browser Fullscreen', exact: true }).click();
		await page.waitForFunction(() => document.fullscreenElement?.classList.contains('remote-desktop-panel'));
		await page.keyboard.press('Escape');
		await page.waitForFunction(() => document.fullscreenElement === null);
		assert.equal(originalSocket.closed, false);
		checks.push(
			protocol +
				' actual window resize, minimize/restore and browser fullscreen preserve the original desktop transport',
		);

		await modal.getByRole('button', { name: 'Touchpad', exact: true }).click();
		assert.equal(
			await modal.getByRole('button', { name: 'Touchpad', exact: true }).getAttribute('aria-pressed'),
			'true',
		);
		await modal.getByRole('button', { name: 'Direct', exact: true }).click();
		const displayElement = modal.locator('.remote-display-container > div').first();
		const displayBox = await displayElement.boundingBox();
		assert.ok(displayBox);

		const mousePosition = () =>
			services
				.x('getmouselocation', '--shell')
				.split('\n')
				.filter((line) => /^(X|Y)=/u.test(line))
				.join('\n');

		const mouseBefore = mousePosition();
		const frameCount = originalSocket.frames.length;
		const touchX = mouseBefore.startsWith('X=12') ? 300 : 120;
		await page.touchscreen.tap(displayBox.x + touchX, displayBox.y + 100);
		await waitFor(
			() => Promise.resolve(originalSocket.frames.slice(frameCount).map(String)),
			(frames) => frames.some((frame) => frame.includes('5.mouse')),
			'Direct touch sends a real Guacamole mouse instruction',
			15000,
		);
		await waitFor(
			() => Promise.resolve(mousePosition()),
			(value) => value !== mouseBefore,
			'Browser direct touch moves the real remote pointer',
			15000,
		);
		assert.ok(originalSocket.frames.slice(frameCount).some((frame) => String(frame).includes('5.mouse')));
		checks.push(protocol + ' browser direct-touch event reaches the actual remote pointer');

		await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
		const clipboardText = 'formal-clipboard-' + protocol;
		await page.evaluate((text) => navigator.clipboard.writeText(text), clipboardText);
		await displayElement.focus();
		await waitFor(
			() =>
				Promise.resolve(
					originalSocket.frames.some((frame) =>
						String(frame).includes(Buffer.from(clipboardText).toString('base64')),
					),
				),
			Boolean,
			'Permitted browser clipboard is sent through the original real Guacamole stream',
			15000,
		);
		const cdp = await page.context().newCDPSession(page);
		const { targetInfo } = await cdp.send('Target.getTargetInfo');
		await page.context().clearPermissions();
		await cdp.send('Browser.setPermission', {
			permission: { name: 'clipboard-read', allowWithoutSanitization: true },
			setting: 'denied',
			origin,
			browserContextId: targetInfo.browserContextId,
		});
		assert.equal(
			await page.evaluate(async () => (await navigator.permissions.query({ name: 'clipboard-read' })).state),
			'denied',
		);
		await page.evaluate(() => {
			const original = navigator.clipboard.readText;
			window.deniedClipboardReads = 0;
			navigator.clipboard.readText = async function () {
				try {
					return await original.call(this);
				} catch (cause) {
					if (cause instanceof DOMException && cause.name === 'NotAllowedError')
						window.deniedClipboardReads += 1;
					throw cause;
				}
			};
			window.restoreClipboardRead = () => {
				navigator.clipboard.readText = original;
			};
		});
		await modal.getByRole('button', { name: 'Touchpad', exact: true }).focus();
		await displayElement.focus();
		await page.waitForFunction(() => window.deniedClipboardReads > 0);
		await modal.getByText('Connected', { exact: true }).first().waitFor();
		assert.equal(originalSocket.closed, false);
		await page.evaluate(() => window.restoreClipboardRead());
		await cdp.detach();
		await page.context().clearPermissions();
		checks.push(
			protocol +
				' real browser clipboard permission sends protocol bytes; explicit denial preserves the original connection',
		);

		await modal.getByRole('button', { name: 'Show keyboard', exact: true }).click();
		const mobile = modal.getByRole('textbox', { name: 'Remote desktop keyboard input', exact: true });
		await mobile.focus();
		services.x('windowfocus', services.x('search', '--name', 'B10-Desktop'));
		await page.keyboard.type('formal-mobile-' + protocol);
		await page.keyboard.press('Enter');
		await waitFor(
			() => services.read('/tmp/typed.txt'),
			(value) => value.includes('formal-mobile-' + protocol),
			'Formal mobile keyboard reaches actual remote desktop',
			20000,
		);
		checks.push(protocol + ' touch-mode controls and real soft-keyboard text reach the original remote window');
		const composedText = 'formal-composition-' + protocol;
		await mobile.evaluate((input, text) => {
			input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
			input.value = text;
			input.dispatchEvent(
				new InputEvent('input', {
					data: text,
					inputType: 'insertCompositionText',
					isComposing: true,
					bubbles: true,
				}),
			);
		}, composedText);
		assert.equal(await mobile.inputValue(), composedText);
		assert.equal(services.read('/tmp/typed.txt').includes(composedText), false);
		await mobile.evaluate((input, text) => {
			input.dispatchEvent(new CompositionEvent('compositionend', { data: text, bubbles: true }));
			input.dispatchEvent(
				new InputEvent('input', { data: text, inputType: 'insertText', isComposing: false, bubbles: true }),
			);
		}, composedText);
		await page.keyboard.press('Enter');
		await waitFor(
			() => services.read('/tmp/typed.txt'),
			(value) => value.includes(composedText),
			'Completed composition reaches actual remote window',
			15000,
		);
		assert.equal(services.read('/tmp/typed.txt').split(composedText).length - 1, 1);
		assert.equal(await mobile.inputValue(), '');
		checks.push(
			protocol +
				' controlled composition retains intermediate input and sends completed text once to the real remote window',
		);

		const count = tickets.length;
		await modal.getByRole('button', { name: 'Reconnect', exact: true }).click();
		await waitFor(
			() => Promise.resolve(tickets.length),
			(value) => value === count + 1,
			'New desktop ticket',
			20000,
		);
		assert.equal(new Set(tickets).size, tickets.length);
		await waitFor(
			() => Promise.resolve(originalSocket.closed),
			Boolean,
			'Original socket released before explicit reconnect',
			20000,
		);
		await modal.getByText('Connected', { exact: true }).first().waitFor();
		await waitFor(
			() => services.connections(),
			(value) => value === 1,
			'Reconnected single backend transport',
			20000,
		);
		checks.push(
			protocol + ' explicit reconnect consumes a distinct new ticket and closes its original actual socket',
		);

		await modal.getByRole('button', { name: 'Close', exact: true }).click();
		await modal.waitFor({ state: 'hidden' });
		await waitFor(
			() => services.connections(),
			(value) => value === 0,
			'Actual modal close releases backend desktop connection',
			20000,
		);
		await waitFor(
			() => Promise.resolve(sockets.every((item) => item.closed)),
			Boolean,
			'All original browser sockets report their actual close events',
			15000,
		);
		checks.push(
			protocol +
				' actual App modal close releases all original browser sockets and real backend desktop transport',
		);
	}
	await page.getByRole('button', { name: 'Connect Frontend VNC', exact: true }).click();
	const finalModal = page.getByRole('dialog', { name: 'Frontend VNC', exact: true });
	await finalModal.getByText('Connected', { exact: true }).first().waitFor();
	await waitFor(
		() => services.connections(),
		(count) => count === 1,
		'Real desktop before formal logout',
		15000,
	);
	await finalModal.getByRole('button', { name: 'Minimize', exact: true }).click();
	await page.getByRole('link', { name: 'Logout', exact: true }).click();
	await page.waitForURL('**/login');
	await finalModal.waitFor({ state: 'hidden' });
	await waitFor(
		() => services.connections(),
		(count) => count === 0,
		'Formal logout releases actual desktop transport',
		20000,
	);
	await waitFor(
		() => Promise.resolve(sockets.every((item) => item.closed)),
		Boolean,
		'Formal logout closes original browser sockets',
		15000,
	);
	checks.push(
		'Formal header logout revokes the App desktop modal and releases its actual browser sockets and backend transport',
	);
	await Promise.allSettled([...ticketReads]);
	assert.deepEqual(errors, []);
	assert.equal(await page.locator('[data-runtime-boundary]').count(), 0);
	console.log('Formal desktop page: ' + checks.length + ' checks PASS\n' + checks.join('\n'));
} finally {
	const results = await Promise.allSettled(
		[() => browser?.close(), () => vite?.close(), () => app?.close()].map((close) => Promise.resolve().then(close)),
	);
	const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
	try {
		services?.close();
	} catch (cause) {
		failures.push(cause);
	}
	try {
		await rm(directory, { recursive: true, force: true });
	} catch (cause) {
		failures.push(cause);
	}
	if (failures.length) throw new AggregateError(failures, 'Desktop frontend fixture cleanup failed');
}
