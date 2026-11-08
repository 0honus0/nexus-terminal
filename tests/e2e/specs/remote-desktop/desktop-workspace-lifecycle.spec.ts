import { test, expect, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import {
	authenticateTestRdp,
	confirmTestRdpCertificate,
	observeDesktopBinaryTraffic,
	revealDesktopControls,
} from '../../support/desktop';
import { desktopService } from '../../support/desktop-service';
import { E2E_URLS, E2E_PORTS } from '../../../support/protocols/test-environment';
import { readConnectionImportResponse } from '../../../../packages/shared/src/targets/connections/http-codec';
import { readRemoteDesktopSessionResponse } from '../../../../packages/shared/src/remote/desktop/http-codec';

test.use({ e2eServices: ['desktop'] });

declare global {
	interface Window {
		__desktopDeniedClipboardReads: number;
		__restoreDesktopClipboard: () => void;
	}
}

test.use({ viewport: { width: 1440, height: 1000 }, hasTouch: true });

async function nonblankCanvas(page: Page): Promise<void> {
	await expect
		.poll(
			() =>
				page.locator('.remote-display-container canvas').evaluateAll((canvases) =>
					canvases.some((canvas) => {
						if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 800 || canvas.height < 600)
							return false;
						const context = canvas.getContext('2d');
						return (
							context &&
							context
								.getImageData(0, 0, canvas.width, canvas.height)
								.data.some((value, index) => index % 4 !== 3 && value > 0)
						);
					}),
				),
			{ timeout: 30000 },
		)
		.toBe(true);
}

for (const protocol of ['VNC', 'RDP'] as const) {
	test(
		protocol +
			' formal desktop preserves its transport through window actions, native input and reconnect, then revokes it on logout',
		async ({ page, context }) => {
			const service = desktopService(context.request);
			await expect.poll(service.connections).toBe(0);
			await loginAsInitialAdmin(context.request);
			await setUiLanguage(context.request);
			const imported = await context.request.post('/api/v1/targets/connections/import', {
				headers: { Origin: E2E_URLS.frontendOrigin },
				data: {
					items: [
						{
							connection: {
								name: 'Frontend ' + protocol,
								type: protocol,
								host: '127.0.0.1',
								port: protocol === 'RDP' ? E2E_PORTS.rdp : E2E_PORTS.vnc,
								username: 'test',
								route: 'direct',
								proxyId: null,
								notes: null,
								tagIds: [],
								jumpIds: [],
							},
							credential: { kind: 'password', password: 'b10-pass' },
						},
					],
				},
			});
			expect(imported.status()).toBe(200);
			const result = readConnectionImportResponse(await imported.json()).items[0];
			if (result.status !== 'ok') throw Error('Actual desktop target installation failed');
			const tickets: string[] = [];
			// Capture each original response body before browser navigation can reclaim it. Never replay issuance.
			await page.route(/\/api\/v1\/connections\/\d+\/(?:rdp|vnc)-session(?:\?|$)/u, async (route) => {
				const response = await route.fetch();
				if (response.status() === 200) {
					const session = readRemoteDesktopSessionResponse(await response.json());
					expect(session.protocol).toBe(protocol);
					tickets.push(session.ticket);
				}
				await route.fulfill({ response });
			});
			const verifyBinaryTraffic = await observeDesktopBinaryTraffic(page);
			const errors: string[] = [];
			const sockets: { closed: boolean }[] = [];
			page.on('pageerror', (cause) => errors.push(cause.message));
			page.on('websocket', (socket) => {
				if (new URL(socket.url()).pathname !== '/ws/remote-desktop') return;
				const record = { closed: false };
				sockets.push(record);
				socket.on('close', () => {
					record.closed = true;
				});
			});
			await page.goto('/');
			await page.getByRole('button', { name: 'Connect Frontend ' + protocol, exact: true }).click();
			if (protocol === 'RDP') {
				await confirmTestRdpCertificate(page, true);
				await authenticateTestRdp(page);
			}
			const modal = page.getByRole('dialog', { name: 'Frontend ' + protocol, exact: true });
			await revealDesktopControls(page, true);
			await expect(modal.getByText('Connected', { exact: true }).first()).toBeVisible();
			await nonblankCanvas(page);
			await expect.poll(service.connections).toBe(1);
			expect(sockets).toHaveLength(1);
			const originalSocket = sockets[0];
			await revealDesktopControls(page, true);

			const width = modal.locator(protocol === 'VNC' ? '#vnc-modal-width' : '#rdp-modal-width');
			const height = modal.locator(protocol === 'VNC' ? '#vnc-modal-height' : '#rdp-modal-height');
			const entered = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			const delivered = Promise.withResolvers<void>();

			const holdSize = async (route: import('@playwright/test').Route) => {
				if (route.request().method() !== 'PUT') return route.continue();
				entered.resolve();
				await release.promise;
				try {
					await route.continue();
				} finally {
					delivered.resolve();
				}
			};

			await page.route('**/api/v1/settings/preferences', holdSize);
			try {
				await width.fill('900');
				await width.press('Tab');
				await entered.promise;
				await expect(height).toBeDisabled();
				await expect(modal.locator('[data-ui="resize-handle"]')).toBeDisabled();
			} finally {
				release.resolve();
			}
			await delivered.promise;
			await expect(height).toBeEnabled();
			await height.fill('700');
			const sizeSaved = page.waitForResponse(
				(response) =>
					new URL(response.url()).pathname === '/api/v1/settings/preferences' &&
					response.request().method() === 'PUT',
			);
			await height.press('Tab');
			expect((await sizeSaved).status()).toBe(200);
			await expect(height).toBeEnabled();
			await page.unroute('**/api/v1/settings/preferences', holdSize);
			await expect
				.poll(() =>
					modal.evaluate((node) => ({
						width: Math.round(node.getBoundingClientRect().width),
						height: Math.round(node.getBoundingClientRect().height),
					})),
				)
				.toEqual({ width: 900, height: 700 });
			await modal.getByRole('button', { name: 'Minimize', exact: true }).click();
			await expect(modal).toBeHidden();
			expect(originalSocket.closed).toBe(false);
			await page.getByRole('button', { name: 'Restore remote desktop window', exact: true }).click();
			await expect(modal).toBeVisible();
			await revealDesktopControls(page, true);
			await modal.getByRole('button', { name: 'Browser Fullscreen', exact: true }).click();
			await page.waitForFunction(() => document.fullscreenElement?.classList.contains('remote-desktop-panel'));
			await page.keyboard.press('Escape');
			await page.waitForFunction(() => document.fullscreenElement === null);
			await expect(modal).not.toHaveClass(/remote-desktop-panel-fullscreen/u);
			expect(originalSocket.closed).toBe(false);
			expect(sockets).toHaveLength(1);

			await revealDesktopControls(page, true);
			if (protocol === 'RDP') await modal.getByRole('button', { name: 'Touch', exact: true }).click();
			await page.getByRole('button', { name: 'Touchpad', exact: true }).click();
			await expect(page.getByRole('button', { name: 'Touchpad', exact: true })).toHaveAttribute(
				'aria-pressed',
				'true',
			);
			await page.getByRole('button', { name: 'Direct', exact: true }).click();
			if (protocol === 'RDP') await page.keyboard.press('Escape');
			const display = modal.locator('.remote-display-container > div').first();
			const box = await display.boundingBox();
			if (!box) throw Error('Actual desktop display missing');
			const pointerBefore = await service.pointer();
			await page.touchscreen.tap(box.x + (pointerBefore.startsWith('X=12') ? 300 : 120), box.y + 100);
			await expect.poll(service.pointer).not.toBe(pointerBefore);
			await verifyBinaryTraffic();
			if (protocol === 'VNC') {
				await expect(page.locator('#noVNC_mouse_capture_elem')).toBeHidden();
				await modal.getByRole('button', { name: 'Touchpad', exact: true }).click();
				await modal.getByRole('button', { name: 'Direct', exact: true }).click();
				const canvas = display.locator('canvas');
				await canvas.evaluate((node) => {
					const rect = node.getBoundingClientRect();
					const touch = new Touch({
						identifier: 1,
						target: node,
						clientX: rect.left + 100,
						clientY: rect.top + 100,
					});
					for (const kind of ['touchstart', 'touchend', 'touchstart']) {
						node.dispatchEvent(
							new TouchEvent(kind, {
								bubbles: true,
								cancelable: true,
								touches: kind === 'touchend' ? [] : [touch],
								changedTouches: [touch],
							}),
						);
					}
				});
				await expect(page.locator('#noVNC_mouse_capture_elem')).toBeVisible();
				await canvas.dispatchEvent('touchcancel', { touches: [], changedTouches: [] });
				await expect(page.locator('#noVNC_mouse_capture_elem')).toBeHidden();
			}

			await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: E2E_URLS.frontendOrigin });
			const marker = protocol + '-' + crypto.randomUUID();
			const clipboardText = 'formal-clipboard-' + marker;
			await revealDesktopControls(page, true);
			await modal.getByRole('button', { name: 'Reconnect', exact: true }).focus();
			await page.evaluate((text) => navigator.clipboard.writeText(text), clipboardText);
			await display.focus();
			await expect.poll(service.clipboard, { timeout: 15000 }).toBe(clipboardText);
			const cdp = await context.newCDPSession(page);
			try {
				const { targetInfo } = await cdp.send('Target.getTargetInfo');
				await context.clearPermissions();
				await cdp.send('Browser.setPermission', {
					permission: { name: 'clipboard-read', allowWithoutSanitization: true },
					setting: 'denied',
					origin: E2E_URLS.frontendOrigin,
					browserContextId: targetInfo.browserContextId,
				});
				expect(
					await page.evaluate(async () => {
						const permission: unknown = await Reflect.apply(
							navigator.permissions.query,
							navigator.permissions,
							[{ name: 'clipboard-read' }],
						);
						if (!(permission instanceof PermissionStatus))
							throw Error('Invalid native permission response');
						return permission.state;
					}),
				).toBe('denied');
				await page.evaluate(() => {
					const original = navigator.clipboard.readText;
					window.__desktopDeniedClipboardReads = 0;
					navigator.clipboard.readText = async function () {
						try {
							return await original.call(this);
						} catch (cause) {
							if (cause instanceof DOMException && cause.name === 'NotAllowedError')
								window.__desktopDeniedClipboardReads++;
							throw cause;
						}
					};
					window.__restoreDesktopClipboard = () => {
						navigator.clipboard.readText = original;
					};
				});
				await revealDesktopControls(page, true);
				await modal
					.getByRole('button', { name: protocol === 'RDP' ? 'Touch' : 'Touchpad', exact: true })
					.focus();
				await display.focus();
				await page.waitForFunction(() => window.__desktopDeniedClipboardReads > 0);
				expect(originalSocket.closed).toBe(false);
				await revealDesktopControls(page, true);
				await expect(modal.getByText('Connected', { exact: true }).first()).toBeVisible();
			} finally {
				await page.evaluate(() => window.__restoreDesktopClipboard?.());
				await cdp.detach();
				await context.clearPermissions();
			}

			if (protocol === 'RDP') {
				await display.tap({ position: { x: 150, y: 180 } });
				await expect(modal.locator('header')).toBeHidden();
			}
			await modal.getByRole('button', { name: 'Show keyboard', exact: true }).tap();
			const mobile = modal.getByRole('textbox', { name: 'Remote desktop keyboard input', exact: true });
			await mobile.focus();
			await service.focus();
			await page.keyboard.type('formal-mobile-' + marker);
			await page.keyboard.press('Enter');
			await expect.poll(service.input, { timeout: 20000 }).toContain('formal-mobile-' + marker);
			const composedText = 'formal-composition-' + marker;
			await mobile.evaluate((input, text) => {
				if (!(input instanceof HTMLTextAreaElement)) throw Error('Actual desktop keyboard missing');
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
			await expect(mobile).toHaveValue(composedText);
			expect(await service.input()).not.toContain(composedText);
			await mobile.evaluate((input, text) => {
				input.dispatchEvent(new CompositionEvent('compositionend', { data: text, bubbles: true }));
				input.dispatchEvent(
					new InputEvent('input', { data: text, inputType: 'insertText', isComposing: false, bubbles: true }),
				);
			}, composedText);
			await page.keyboard.press('Enter');
			await expect.poll(service.input, { timeout: 15000 }).toContain(composedText);
			expect((await service.input()).split(composedText)).toHaveLength(2);
			await expect(mobile).toHaveValue('');

			await revealDesktopControls(page, true);
			const count = tickets.length;
			await modal.getByRole('button', { name: 'Reconnect', exact: true }).click();
			await expect.poll(() => tickets.length).toBe(count + 1);
			expect(new Set(tickets).size).toBe(tickets.length);
			await expect.poll(() => originalSocket.closed).toBe(true);
			if (protocol === 'RDP') await authenticateTestRdp(page);
			await revealDesktopControls(page, true);
			await expect(modal.getByText('Connected', { exact: true }).first()).toBeVisible();
			await expect.poll(service.connections).toBe(1);
			await revealDesktopControls(page, true);
			await modal.getByRole('button', { name: 'Close', exact: true }).click();
			await expect(modal).toBeHidden();
			await expect.poll(service.connections).toBe(0);
			await expect.poll(() => sockets.every((socket) => socket.closed)).toBe(true);

			await page.getByRole('button', { name: 'Connect Frontend ' + protocol, exact: true }).click();
			if (protocol === 'RDP') await authenticateTestRdp(page);
			await revealDesktopControls(page, true);
			await expect(modal.getByText('Connected', { exact: true }).first()).toBeVisible();
			await expect.poll(service.connections).toBe(1);
			await revealDesktopControls(page, true);
			await modal.getByRole('button', { name: 'Minimize', exact: true }).click();
			await page.getByRole('link', { name: 'Logout', exact: true }).click();
			await expect(page).toHaveURL(/\/login$/u);
			await expect(modal).toBeHidden();
			await expect.poll(service.connections).toBe(0);
			await expect.poll(() => sockets.every((socket) => socket.closed)).toBe(true);
			await expect(page.locator('[data-runtime-boundary]')).toHaveCount(0);
			expect(errors).toEqual([]);
		},
	);
}
