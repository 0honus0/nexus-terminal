import { createServer, type Socket } from 'node:net';
import { test, expect } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { E2E_URLS } from '../../../support/protocols/test-environment';
import { readConnectionImportResponse } from '../../../../packages/shared/src/targets/connections/http-codec';

declare global {
	interface Window {
		__terminalObservedInstances: number;
	}
}

// A real failed TCP handshake and xterm/ResizeObserver disposal need a browser.
// Ordinary failure-state combinations remain in the workspace logic tests.
test('failed terminal keeps one reusable retry view and closing it reclaims xterm, observers and sockets', async ({
	page,
	context,
}) => {
	const upstreams = new Set<Socket>();
	let attempts = 0;
	const server = createServer((socket) => {
		attempts++;
		upstreams.add(socket);
		socket.once('close', () => upstreams.delete(socket));
		socket.destroy();
	});
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw Error('Expected isolated TCP listener');
	const sockets: { closed: boolean }[] = [];
	const errors: string[] = [];
	page.on('pageerror', (cause) => errors.push(cause.message));
	page.on('websocket', (socket) => {
		if (new URL(socket.url()).pathname !== '/ws/workspace') return;
		const observed = { closed: false };
		sockets.push(observed);
		socket.on('close', () => {
			observed.closed = true;
		});
	});
	try {
		await loginAsInitialAdmin(context.request);
		await setUiLanguage(context.request);
		const response = await context.request.post('/api/v1/targets/connections/import', {
			headers: { Origin: E2E_URLS.frontendOrigin },
			data: {
				items: [
					{
						connection: {
							name: 'Failed terminal recovery',
							type: 'SSH',
							host: '127.0.0.1',
							port: address.port,
							username: 'tester',
							route: 'direct',
							proxyId: null,
							notes: null,
							tagIds: [],
							jumpIds: [],
						},
						credential: { kind: 'password', password: 'controlled-terminal-password' },
					},
				],
			},
		});
		expect(response.status()).toBe(200);
		const imported = readConnectionImportResponse(await response.json()).items[0];
		if (imported.status !== 'ok') throw Error('Failed terminal target import refused');
		await page.addInitScript(() => {
			const NativeObserver = window.ResizeObserver;
			const targets = new WeakMap<ResizeObserver, Set<Element>>();

			const observedTargets = (observer: ResizeObserver): Set<Element> => {
				let observed = targets.get(observer);
				if (!observed) {
					observed = new Set<Element>();
					targets.set(observer, observed);
				}
				return observed;
			};

			window.__terminalObservedInstances = 0;
			window.ResizeObserver = class extends NativeObserver {
				observe(target: Element, options?: ResizeObserverOptions): void {
					super.observe(target, options);
					const observed = observedTargets(this);
					if (!observed.size) window.__terminalObservedInstances++;
					observed.add(target);
				}

				unobserve(target: Element): void {
					super.unobserve(target);
					const observed = observedTargets(this);
					if (observed.delete(target) && !observed.size) window.__terminalObservedInstances--;
				}

				disconnect(): void {
					super.disconnect();
					const observed = observedTargets(this);
					if (observed.size) window.__terminalObservedInstances--;
					observed.clear();
				}
			};
		});
		await page.goto('/workspace');
		const row = page.locator(`.workspace-connection-list [data-connection-id="${imported.id}"]`);
		await expect(row).toBeVisible();
		await expect(page.locator('.xterm')).toHaveCount(0);
		const baseline = await page.evaluate(() => window.__terminalObservedInstances);
		for (let cycle = 0; cycle < 2; cycle++) {
			await row.click();
			const tab = page.getByRole('tab', { selected: true });
			const notice = page.locator('.terminal-reconnect-notice');
			await expect(tab).toHaveAttribute('data-session-state', 'error');
			await expect(notice).toBeVisible();
			await expect(notice).toContainText('Terminal is not connected');
			await expect(notice).not.toContainText('remote_unavailable');
			await expect(notice).not.toContainText('controlled-terminal-password');
			await expect(page.locator('.xterm')).toHaveCount(1);
			const terminal = await page.locator('.xterm').elementHandle();
			const failedObservers = await page.evaluate(() => window.__terminalObservedInstances);
			expect(failedObservers).toBeGreaterThan(baseline);
			const previousAttempts = attempts;
			const previousSockets = sockets.length;
			if (cycle === 0) await notice.getByRole('button', { name: 'Reconnect', exact: true }).click();
			else {
				await page.locator('.xterm-helper-textarea').focus();
				await page.keyboard.press('Enter');
			}
			await expect.poll(() => sockets.length).toBe(previousSockets + 1);
			await expect.poll(() => attempts).toBe(previousAttempts + 1);
			await expect(tab).toHaveAttribute('data-session-state', 'error');
			await expect(notice).toBeVisible();
			expect(await terminal?.evaluate((element) => element === document.querySelector('.xterm'))).toBe(true);
			await expect.poll(() => page.evaluate(() => window.__terminalObservedInstances)).toBe(failedObservers);
			await tab.getByRole('button', { name: 'Close Tab', exact: true }).click();
			await expect(page.getByRole('tab')).toHaveCount(0);
			await expect(page.locator('.xterm')).toHaveCount(0);
			await expect.poll(() => page.evaluate(() => window.__terminalObservedInstances)).toBe(baseline);
			await expect.poll(() => sockets.every((socket) => socket.closed)).toBe(true);
			await expect.poll(() => upstreams.size).toBe(0);
			await expect(row).toBeVisible();
		}
		expect(errors).toEqual([]);
		await expect(page.locator('[data-runtime-boundary]')).toHaveCount(0);
	} finally {
		await page.close();
		for (const socket of upstreams) socket.destroy();
		await new Promise<void>((resolve, reject) => server.close((cause) => (cause ? reject(cause) : resolve())));
	}
});
