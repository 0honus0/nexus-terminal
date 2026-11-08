import {
	authenticateTestRdp,
	createTestRdpSession,
	confirmTestRdpCertificate,
	observeDesktopAudioContexts,
	observeDesktopBinaryTraffic,
	revealDesktopControls,
} from '../../support/desktop';
import { readConnectionList } from '../../../../packages/shared/src/targets/connections/http-codec';
import { readTestConnectionImportId } from '../../../support/http/target-import';
import { expect, test, type APIRequestContext, type Locator, type Page } from '../../support/fixtures';
import { getUiPreferences, loginAsInitialAdmin, updateUiPreferences } from '../../support/auth';
import { step } from '../../support/steps';
import { E2E_URLS, E2E_PORTS } from '../../../support/protocols/test-environment';

test.use({ e2eServices: ['desktop'] });

const CONNECTION_NAME = 'E2E RDP Browser';

const remoteWindow = (page: Page): Locator => page.locator('.remote-desktop-panel');

const RDP_TOOLBAR_TAB_ORDER = [
	'Width',
	'Increase value',
	'Decrease value',
	'Height',
	'Increase value',
	'Decrease value',
	'Reconnect',
	'File clipboard',
	'Browser Fullscreen',
	'Minimize',
	'Close',
];

async function expectRdpToolbarLayout(panel: Locator, touch = false): Promise<void> {
	const layout = await panel.evaluate((element) => {
		const chrome = element.querySelector<HTMLElement>('[data-desktop-chrome]');
		if (!chrome) throw new Error('RDP window controls are missing');
		const panelBox = element.getBoundingClientRect();
		const controls = Array.from(chrome.querySelectorAll<HTMLElement>('input, button')).filter((control) =>
			control.checkVisibility(),
		);
		return {
			compact: panelBox.width < 900,
			height: chrome.getBoundingClientRect().height,
			order: controls.map((control) => control.getAttribute('aria-label') || control.textContent?.trim()),
			overflow: chrome.scrollWidth - chrome.clientWidth,
			insidePanel: controls.every((control) => {
				const box = control.getBoundingClientRect();
				return box.width > 0 && box.left >= panelBox.left && box.right <= panelBox.right;
			}),
		};
	});
	const order = layout.compact
		? [
				'Window size',
				'Reconnect',
				'File clipboard',
				...(touch ? ['Touch'] : []),
				'Browser Fullscreen',
				'Minimize',
				'Close',
			]
		: RDP_TOOLBAR_TAB_ORDER;
	expect(layout.order).toEqual(order);
	expect(layout.height).toBeLessThanOrEqual(48);
	expect(layout.overflow).toBe(0);
	expect(layout.insidePanel).toBe(true);
}

const connectionCard = (page: Page, name: string): Locator =>
	page.locator('.connection-card').filter({ has: page.getByText(name, { exact: true }) });

async function openWorkspaceConnectionList(page: Page) {
	await page.getByRole('button', { name: 'New Connection Tab', exact: true }).click();
	const connectionList = page.locator('.workspace-connection-list:visible');
	await expect(connectionList).toBeVisible();
	return connectionList;
}

async function cleanupConnection(request: APIRequestContext): Promise<void> {
	const response = await request.get('/api/v1/targets/connections');
	expect(response.ok()).toBeTruthy();
	const connections = readConnectionList(await response.json());
	for (const connection of connections.filter((item) => item.name === CONNECTION_NAME)) {
		expect(
			(
				await request.delete(`/api/v1/targets/connections/${connection.id}`, {
					headers: { Origin: E2E_URLS.frontendOrigin },
				})
			).ok(),
		).toBeTruthy();
	}
}

test('RDP browser client preserves settings, clipboard and browser fullscreen', async ({ page, context }) => {
	const expectBinaryTraffic = await observeDesktopBinaryTraffic(page);
	await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: E2E_URLS.frontendOrigin });
	await loginAsInitialAdmin(context.request);
	await updateUiPreferences(context.request, (preferences) => {
		preferences.language = 'en-US';
	});
	await cleanupConnection(context.request);

	await page.addInitScript(() => {
		let fullscreenElement: Element | null = null;
		Object.defineProperty(document, 'fullscreenElement', {
			configurable: true,

			get: () => fullscreenElement,
		});
		Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
			configurable: true,

			value: function requestFullscreen() {
				fullscreenElement = this;
				document.dispatchEvent(new Event('fullscreenchange'));
				return Promise.resolve();
			},
		});
		Object.defineProperty(document, 'exitFullscreen', {
			configurable: true,

			value: () => {
				fullscreenElement = null;
				document.dispatchEvent(new Event('fullscreenchange'));
				return Promise.resolve();
			},
		});
	});

	let connectionId = 0;
	try {
		await page.goto('/connections');

		await step('normal RDP configuration has no removed RemoteApp controls', async () => {
			await page.getByRole('button', { name: 'Add New Connection', exact: true }).click();
			const form = page.locator('form');
			await expect(form).toBeVisible();
			await form.getByRole('radio', { name: 'RDP', exact: true }).click();
			await expect(form.getByRole('switch', { name: 'Launch RemoteApp', exact: true })).toHaveCount(0);
			await expect(form.getByText('RemoteApp alias', { exact: true })).toHaveCount(0);

			await form.locator('#conn-name').fill(CONNECTION_NAME);
			await form.locator('#conn-host').fill('127.0.0.1');
			await form.locator('#conn-port').fill(String(E2E_PORTS.rdp));
			await form.locator('#conn-username').fill('rdp-remoteapp-user');
			await form.locator('#conn-password-rdp').fill('b10-pass');

			// Capture the one mutation receipt before forwarding it: the form navigates
			// after success, which can evict CDP's response body.
			await page.route('**/api/v1/targets/connections/import', async (route) => {
				if (route.request().method() !== 'POST') return route.fallback();
				const receipt = await route.fetch();
				expect(receipt.status()).toBe(200);
				connectionId = readTestConnectionImportId(await receipt.json());
				await route.fulfill({ response: receipt });
			});
			await form.locator('button[type="submit"]').click();
			await expect(form).toBeHidden({ timeout: 15_000 });

			const persisted = await context.request.get(`/api/v1/targets/connections/${connectionId}`);
			expect(persisted.ok()).toBeTruthy();
			await expect(persisted.json()).resolves.toMatchObject({
				id: connectionId,
				type: 'RDP',
			});
		});

		await step('editing preserves normal RDP fields without RemoteApp controls', async () => {
			await connectionCard(page, CONNECTION_NAME).getByRole('button', { name: 'Edit', exact: true }).click();
			const form = page.locator('form');
			await expect(form.locator('#conn-host')).toHaveValue('127.0.0.1');
			await expect(form.getByRole('switch', { name: 'Launch RemoteApp', exact: true })).toHaveCount(0);
			await form.getByRole('button', { name: /cancel/i }).click();
			await expect(form).toBeHidden();
		});

		await step('RDP session configuration is delivered without caching', async () => {
			const session = await createTestRdpSession(context.request, connectionId, '?width=1440&height=900&dpi=120');
			expect(session.ok()).toBeTruthy();
			await expect(session.json()).resolves.toMatchObject({ ticket: expect.any(String) });
		});

		await step(
			'Connections launches RDP in the app-level surface without leaving connection management',
			async () => {
				await page.goto('/connections');
				const row = connectionCard(page, CONNECTION_NAME);
				await expect(row).toBeVisible();
				await row.getByRole('button', { name: 'Connect', exact: true }).click();
				await expect(page).toHaveURL(/\/connections$/);
				const modal = remoteWindow(page);
				await expect(modal).toBeVisible();
				const certificate = page.getByRole('dialog', { name: 'Confirm RDP server certificate', exact: true });
				await expect(certificate).toBeVisible();
				await expect(modal.locator('canvas')).toHaveCount(0);
				await certificate.getByRole('button', { name: 'Cancel', exact: true }).click();
				await expect(certificate).toBeHidden();
				await expect(modal).toContainText('Disconnected');
				await expect(modal.locator('canvas')).toHaveCount(0);
				await modal.getByRole('button', { name: 'Reconnect', exact: true }).click();
				await confirmTestRdpCertificate(page);
				await expect(modal).toContainText('Connected', { timeout: 15_000 });
				await authenticateTestRdp(page);
				const display = modal.locator('.remote-display-container');
				const canvas = display.locator('canvas').first();
				await expect(canvas).toBeAttached();
				await expect(display).toHaveCSS('isolation', 'isolate');
				await expect
					.poll(() =>
						canvas.evaluate((element) => ({
							zIndex: getComputedStyle(element).zIndex,
							width: (element as HTMLCanvasElement).width,
							height: (element as HTMLCanvasElement).height,
						})),
					)
					.toMatchObject({ zIndex: '1', width: expect.any(Number), height: expect.any(Number) });
				expect(await canvas.evaluate((element) => (element as HTMLCanvasElement).width)).toBeGreaterThan(0);
				expect(await canvas.evaluate((element) => (element as HTMLCanvasElement).height)).toBeGreaterThan(0);
				// A connected SDK and non-zero canvas do not prove its deferred pixel submission reached the screen.
				await expect
					.poll(() =>
						canvas.evaluate((element) => {
							if (!(element instanceof HTMLCanvasElement)) throw new Error('RDP canvas is missing');
							const context = element.getContext('2d');
							if (!context) throw new Error('RDP canvas context is missing');
							const pixels = context.getImageData(0, 0, element.width, element.height).data;
							let opaque = 0;
							const colors = new Set<number>();
							for (let index = 0; index < pixels.length; index += 256) {
								if (pixels[index + 3] === 255) opaque++;
								colors.add(
									(pixels[index] ?? 0) * 65536 +
										(pixels[index + 1] ?? 0) * 256 +
										(pixels[index + 2] ?? 0),
								);
							}
							return opaque > 100 && colors.size > 1;
						}),
					)
					.toBe(true);
				await revealDesktopControls(page);
				await modal.getByRole('button', { name: 'Close', exact: true }).click();
				await expect(modal).toBeHidden();
				await expect(page).toHaveURL(/\/connections$/);
			},
		);

		await step('Dashboard launches the same RDP surface without replacing the dashboard route', async () => {
			await page.goto('/');
			const dashboard = page.locator('.dashboard-page');
			const connectionRow = dashboard
				.locator('[data-last-connected-at]')
				.filter({ has: page.getByText(CONNECTION_NAME, { exact: true }) });
			await expect(connectionRow).toBeVisible({ timeout: 20_000 });
			const previousLastConnectedAt = Number(await connectionRow.getAttribute('data-last-connected-at'));
			await page.waitForTimeout(1_100);
			await connectionRow.getByRole('button', { name: `Connect ${CONNECTION_NAME}`, exact: true }).click();
			await expect(page).toHaveURL(/\/$/);
			const modal = remoteWindow(page);
			await expect(modal).toBeVisible();
			await confirmTestRdpCertificate(page, true);
			await expect(modal).toContainText('Connected', { timeout: 15_000 });
			await authenticateTestRdp(page);
			await expect
				.poll(async () => Number(await connectionRow.getAttribute('data-last-connected-at')), {
					timeout: 10_000,
				})
				.toBeGreaterThan(previousLastConnectedAt);
			await revealDesktopControls(page);
			await modal.getByRole('button', { name: 'Close', exact: true }).click();
			await expect(modal).toBeHidden();
			await expect(page).toHaveURL(/\/$/);
		});

		await step('RDP opens from the clean Workspace without rendering an empty Progress Display', async () => {
			await page.goto('/workspace');
			await expect(page.getByRole('button', { name: 'Progress Display', exact: true })).toHaveCount(0);

			const connectionList = await openWorkspaceConnectionList(page);
			await connectionList.getByText(CONNECTION_NAME, { exact: true }).first().click();

			const modal = remoteWindow(page);
			await expect(modal).toBeVisible();
			await expect(modal).toContainText('Connected', { timeout: 15_000 });
			await expect(page.getByRole('dialog', { name: 'Confirm RDP server certificate', exact: true })).toHaveCount(
				0,
			);
			await revealDesktopControls(page);
			await expect(modal.locator('i.fa-desktop')).toBeVisible();
			await expect(modal.locator('i.fa-expand')).toBeVisible();
			await expect(modal.locator('i.fa-window-minimize')).toBeVisible();
			await expect(modal.locator('i.fa-times')).toBeVisible();
			await expect(page.getByRole('dialog', { name: 'Progress Display', exact: true })).toHaveCount(0);
			await expect(modal).toContainText('Connected', { timeout: 15_000 });
			await authenticateTestRdp(page);
		});

		await step('floating RDP controls preserve desktop geometry and keyboard access', async () => {
			const panel = remoteWindow(page);
			const chrome = panel.locator('[data-desktop-chrome]');
			const canvas = panel.locator('canvas');
			await canvas.click({ position: { x: 180, y: 160 } });
			await page.mouse.move(0, 0);
			await expect(chrome).toBeHidden();
			const before = await panel.locator('.remote-display-container').boundingBox();
			expect(before).not.toBeNull();
			const anchor = await panel.locator('textarea').boundingBox();
			const canvasBox = await canvas.boundingBox();
			expect(anchor).not.toBeNull();
			expect(canvasBox).not.toBeNull();
			expect(anchor!.x).toBeCloseTo(canvasBox!.x + 180, 0);
			expect(anchor!.y).toBeCloseTo(canvasBox!.y + 160, 0);
			await revealDesktopControls(page);
			expect(await panel.locator('.remote-display-container').boundingBox()).toEqual(before);
			const chromeBox = await chrome.boundingBox();
			expect(chromeBox).not.toBeNull();
			expect(chromeBox!.y).toBeCloseTo(before!.y, 0);
			await canvas.hover({ position: { x: 180, y: 240 } });
			await expect(chrome).toBeHidden();
			await revealDesktopControls(page);
			await page.mouse.move(0, 0);
			await expect(chrome).toBeHidden();
			const edge = panel.getByRole('button', { name: 'Show window controls', exact: true });
			await edge.focus();
			await page.keyboard.press('Enter');
			await expect(chrome).toBeVisible();
			await expectRdpToolbarLayout(panel);
			await expect(panel.getByRole('spinbutton', { name: 'Width', exact: true })).toBeFocused();
			for (const [index, name] of RDP_TOOLBAR_TAB_ORDER.entries()) {
				if (index > 0) await page.keyboard.press('Tab');
				expect(
					await page.evaluate(
						() =>
							document.activeElement?.getAttribute('aria-label') ||
							document.activeElement?.textContent?.trim(),
					),
				).toBe(name);
			}
			await page.keyboard.press('Escape');
			await expect(chrome).toBeHidden();
			await expect(edge).toBeFocused();
			await revealDesktopControls(page);
			await panel.getByRole('button', { name: 'File clipboard', exact: true }).click();
			const files = page.getByRole('dialog', { name: 'File clipboard', exact: true });
			await expect(files).toBeVisible();
			await page.mouse.move(0, 0);
			await expect(files).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(files).toBeHidden();
		});

		await step(
			'RDP clipboard synchronizes plain text in both directions without replacing the session',
			async () => {
				const hostText = 'NEXUS_RDP_HOST_CLIPBOARD_E2E_' + crypto.randomUUID();
				await page.evaluate((text) => navigator.clipboard.writeText(text), hostText);
				const displayElement = remoteWindow(page).locator('.remote-display-container [tabindex="0"]').first();
				await expect(displayElement).toBeAttached({ timeout: 15_000 });
				await displayElement.dispatchEvent('focus');
				await expect
					.poll(
						async () =>
							(
								await (
									await context.request.get(E2E_URLS.desktopControlOrigin + '/e2e/desktop/clipboard')
								).json()
							).text,
					)
					.toBe(hostText);
				await expectBinaryTraffic();

				const remoteText = 'NEXUS_RDP_REMOTE_CLIPBOARD_E2E_' + crypto.randomUUID();
				const remoteClipboard = await context.request.post(
					`${E2E_URLS.desktopControlOrigin}/e2e/desktop/clipboard`,
					{
						data: { text: remoteText },
					},
				);
				expect(remoteClipboard.ok()).toBeTruthy();
				await expect
					.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 15_000 })
					.toBe(remoteText);
				await expect(remoteWindow(page)).toContainText('Connected');
			},
		);

		await step('browser fullscreen is borderless, hides Nexus chrome, and Escape restores the window', async () => {
			const panel = remoteWindow(page);
			const fullscreen = panel.getByRole('button', { name: 'Browser Fullscreen', exact: true });
			const header = panel.locator('header');
			const actions = panel.locator('.remote-desktop-actions');
			await expect(panel).toBeVisible();
			await revealDesktopControls(page);
			await expect(fullscreen).toBeVisible();
			await expect(header).toBeVisible();
			await expect(actions).toBeVisible();
			await expect(panel.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();

			const normalBox = await panel.boundingBox();
			expect(normalBox).toBeTruthy();
			const viewport = page.viewportSize();
			expect(viewport).toBeTruthy();

			await fullscreen.click();
			await expect.poll(() => panel.evaluate((element) => document.fullscreenElement === element)).toBe(true);
			await expect(header).toBeHidden();
			await expect(actions).toBeHidden();
			const fullscreenBox = await panel.boundingBox();
			expect(fullscreenBox).toBeTruthy();
			expect(Math.abs(fullscreenBox!.x)).toBeLessThanOrEqual(1);
			expect(Math.abs(fullscreenBox!.y)).toBeLessThanOrEqual(1);
			expect(Math.abs(fullscreenBox!.width - viewport!.width)).toBeLessThanOrEqual(1);
			expect(Math.abs(fullscreenBox!.height - viewport!.height)).toBeLessThanOrEqual(1);
			await expect
				.poll(() =>
					panel.evaluate((element) => {
						const style = window.getComputedStyle(element);
						return {
							borderTopWidth: style.borderTopWidth,
							borderRadius: style.borderRadius,
							boxShadow: style.boxShadow,
						};
					}),
				)
				.toEqual({ borderTopWidth: '0px', borderRadius: '0px', boxShadow: 'none' });

			await page.keyboard.press('Escape');
			await expect.poll(() => panel.evaluate((element) => document.fullscreenElement === element)).toBe(false);
			// Restored RDP chrome follows its normal edge-hover interaction after leaving fullscreen.
			await revealDesktopControls(page);
			await expect(header).toBeVisible();
			await expect(actions).toBeVisible();
			await expect(panel.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
			const restoredBox = await panel.boundingBox();
			expect(restoredBox).toBeTruthy();
			expect(restoredBox!.width).toBeLessThan(viewport!.width);
		});
	} finally {
		await cleanupConnection(context.request);
	}
});

const POINTER_RDP_NAME = 'E2E RDP Pointer Interactions';
const POINTER_VNC_NAME = 'E2E VNC Pointer Interactions';

async function createRemoteConnection(
	request: APIRequestContext,
	type: 'RDP' | 'VNC',
	name: string,
	host: string,
	port: number,
): Promise<number> {
	const response = await request.post('/api/v1/targets/connections/import', {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: {
			items: [
				{
					connection: {
						name: name,
						type: type,
						host: host,
						port: port,
						username: `${type.toLowerCase()}-pointer-user`,
						notes: null,
						route: 'direct',
						proxyId: null,
						tagIds: [],
						jumpIds: [],
					},
					credential: { kind: 'password', password: 'b10-pass' },
				},
			],
		},
	});
	expect(response.status(), await response.text()).toBe(200);
	const id = readTestConnectionImportId(await response.json());
	if (type === 'RDP') await createTestRdpSession(request, id, '', true);
	return id;
}

async function openRemoteConnection(page: Page, name: string): Promise<void> {
	await page.goto('/workspace');
	const connectionList = await openWorkspaceConnectionList(page);
	await connectionList.getByText(name, { exact: true }).first().click();
	await expect(remoteWindow(page)).toBeVisible();
}

test('wide RDP restores the legacy 120 DPI connection rule', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await page.setViewportSize({ width: 2400, height: 1200 });
	await updateUiPreferences(context.request, (preferences) => {
		preferences.language = 'en-US';
		preferences.rdpModalWidth = 2200;
		preferences.rdpModalHeight = 900;
	});

	const name = 'E2E RDP Wide DPI';
	const connectionId = await createRemoteConnection(context.request, 'RDP', name, '127.0.0.1', E2E_PORTS.rdp);
	try {
		await page.goto('/workspace');
		const connectionList = await openWorkspaceConnectionList(page);

		const sessionRequestPromise = page.waitForRequest(
			(request) =>
				request.method() === 'POST' &&
				request.url().includes(`/api/v1/connections/${connectionId}/rdp-session`),
		);
		const received: Buffer[] = [];
		const tunnelPromise = page
			.waitForEvent('websocket', {
				predicate: (socket) => socket.url().includes('/ws/remote-desktop'),
			})
			.then((socket) => {
				socket.on('framereceived', ({ payload }) => {
					if (typeof payload !== 'string') received.push(Buffer.from(payload));
				});
				return socket;
			});
		await connectionList.getByText(name, { exact: true }).first().click();

		const sessionRequest = await sessionRequestPromise;
		const sessionUrl = new URL(sessionRequest.url());
		expect(Number(sessionUrl.searchParams.get('width'))).toBeGreaterThan(1920);
		expect(sessionUrl.searchParams.get('dpi')).toBe('120');

		const tunnel = await tunnelPromise;
		const tunnelUrl = new URL(tunnel.url());
		expect(tunnelUrl.searchParams.get('ticket')).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(tunnelUrl.searchParams.has('width')).toBe(false);
		expect(tunnelUrl.searchParams.has('dpi')).toBe(false);
		await expect(remoteWindow(page)).toContainText('Connected', { timeout: 15_000 });
		await authenticateTestRdp(page);
		// The handshake must not consume a WS message containing the next RDP PDU.
		const tpkt = received.filter((frame) => frame[0] === 3);
		expect(tpkt.length).toBeGreaterThan(0);
		for (const frame of tpkt) {
			expect(frame.length).toBeGreaterThanOrEqual(7);
			expect(frame.readUInt16BE(2)).toBe(frame.length);
		}
	} finally {
		await context.request.delete(`/api/v1/targets/connections/${connectionId}`, {
			headers: { Origin: E2E_URLS.frontendOrigin },
		});
	}
});

async function dragBy(
	page: Page,
	target: Locator,
	deltaX: number,
	deltaY: number,
	end: 'pointerup' | 'pointercancel' | 'blur' = 'pointerup',
): Promise<void> {
	const box = await target.boundingBox();
	expect(box).toBeTruthy();
	const startX = box!.x + box!.width / 2;
	const startY = box!.y + box!.height / 2;
	const pointerId = 7;

	// Dispatch pointer-only input so this fails if the shared interaction regresses back
	// to mouse-specific listeners. A pen pointer also covers the non-mouse path explicitly.
	await target.dispatchEvent('pointerdown', {
		bubbles: true,
		cancelable: true,
		pointerId,
		pointerType: 'pen',
		isPrimary: true,
		button: 0,
		buttons: 1,
		clientX: startX,
		clientY: startY,
	});
	await page.evaluate(
		({ x, y, id, end }) => {
			window.dispatchEvent(
				new PointerEvent('pointermove', {
					bubbles: true,
					cancelable: true,
					pointerId: id,
					pointerType: 'pen',
					isPrimary: true,
					buttons: 1,
					clientX: x,
					clientY: y,
				}),
			);
			window.dispatchEvent(
				end === 'blur'
					? new Event('blur')
					: new PointerEvent(end, {
							bubbles: true,
							cancelable: true,
							pointerId: id,
							pointerType: 'pen',
							isPrimary: true,
							button: 0,
							buttons: 0,
							clientX: x,
							clientY: y,
						}),
			);
		},
		{ x: startX + deltaX, y: startY + deltaY, id: pointerId, end },
	);
}

async function exercisePointerWindow(page: Page): Promise<void> {
	const panel = remoteWindow(page);
	await expect(panel).toBeVisible();
	// Connecting chrome is always shown; exercise the stable connected auto-hide interaction.
	await expect(panel).toContainText('Connected', { timeout: 15_000 });

	const initialPanelBox = await panel.boundingBox();
	expect(initialPanelBox).toBeTruthy();
	const resizeHandle = panel.getByLabel('Resize window', { exact: true });
	const resizeHandleBox = await resizeHandle.boundingBox();
	expect(resizeHandleBox).toBeTruthy();
	const resizeHitTarget = await resizeHandle.evaluate(
		(element, { x, y }) => element.contains(document.elementFromPoint(x, y)),
		{
			x: resizeHandleBox!.x + resizeHandleBox!.width / 2,
			y: resizeHandleBox!.y + resizeHandleBox!.height / 2,
		},
	);
	expect(resizeHitTarget).toBe(true);
	const savedSize = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/v1/settings/preferences' &&
			response.request().method() === 'PUT',
	);
	// Pen/touch coordinates and browser zoom produce fractional CSS pixels.
	await dragBy(page, resizeHandle, 120.125, 90.125);
	expect((await savedSize).status()).toBe(200);
	await expect.poll(async () => panel.boundingBox()).not.toBeNull();
	const resizedPanelBox = await panel.boundingBox();
	expect(resizedPanelBox).toBeTruthy();
	expect(resizedPanelBox!.x + resizedPanelBox!.width).toBeCloseTo(
		initialPanelBox!.x + initialPanelBox!.width + 120,
		0,
	);
	expect(resizedPanelBox!.y + resizedPanelBox!.height).toBeCloseTo(
		initialPanelBox!.y + initialPanelBox!.height + 90,
		0,
	);
	expect(resizedPanelBox!.width).toBeCloseTo(initialPanelBox!.width + 240, 0);
	expect(resizedPanelBox!.height).toBeCloseTo(initialPanelBox!.height + 180, 0);
	const { preferences } = await getUiPreferences(page.request);
	const protocol = (await panel.locator('#rdp-modal-width').count()) > 0 ? 'RDP' : 'VNC';
	expect(protocol === 'RDP' ? preferences.rdpModalWidth : preferences.vncModalWidth).toBe(
		Math.round(resizedPanelBox!.width),
	);
	expect(protocol === 'RDP' ? preferences.rdpModalHeight : preferences.vncModalHeight).toBe(
		Math.round(resizedPanelBox!.height),
	);

	await revealDesktopControls(page);
	await panel.getByRole('button', { name: 'Minimize', exact: true }).click();
	await expect(panel).toBeHidden();
	const restore = page.getByRole('button', { name: 'Restore remote desktop window', exact: true });
	await expect(restore).toBeVisible();
	const initialRestoreBox = await restore.boundingBox();
	expect(initialRestoreBox).toBeTruthy();
	if (protocol === 'RDP') {
		await page.mouse.move(400, 100);
		await expect(restore).toHaveAttribute('data-dock', 'left');
		await expect(restore).toHaveCSS('transform', 'matrix(1, 0, 0, 1, -25, 0)');
	}

	await dragBy(page, restore, 140, 80);
	await expect(panel).toBeHidden();
	const movedRestoreBox = await restore.boundingBox();
	expect(movedRestoreBox).toBeTruthy();
	if (protocol === 'RDP') {
		await expect(restore).toHaveAttribute('data-dock', 'left');
		await dragBy(page, restore, page.viewportSize()!.width, 0);
		await expect(restore).toHaveAttribute('data-dock', 'right');
		await restore.focus();
		await page.keyboard.press('ArrowRight');
		await expect(restore).toHaveCSS('transform', 'none');
		await restore.blur();
	} else {
		expect(movedRestoreBox!.x).toBeGreaterThan(initialRestoreBox!.x + 80);
	}
	expect(movedRestoreBox!.y).toBeGreaterThan(initialRestoreBox!.y + 40);

	// Browsers normally emit a click after a pointer drag on the same moving button.
	// That click must be swallowed once, while the next intentional click restores it.
	await restore.dispatchEvent('click', { detail: 1 });
	await expect(panel).toBeHidden();
	await restore.click();
	await expect(panel).toBeVisible();
	await expect(restore).toBeHidden();

	// Keyboard activation has detail 0 and must work on its first attempt even when no drag click arrived.
	for (const [end, key] of [
		['pointercancel', 'Enter'],
		['pointerup', 'Space'],
		['blur', 'Enter'],
	] as const) {
		await revealDesktopControls(page);
		await panel.getByRole('button', { name: 'Minimize', exact: true }).click();
		await expect(restore).toBeVisible();
		await dragBy(page, restore, -80, -30, end);
		await restore.focus();
		await page.keyboard.press(key);
		await expect(panel).toBeVisible();
		await expect(restore).toBeHidden();
	}

	const originalViewport = page.viewportSize();
	expect(originalViewport).toBeTruthy();
	const originalSelection = await page.evaluate(() => document.body.style.userSelect);
	const savedPreferences = await getUiPreferences(page.request);
	const reconnectRequests: string[] = [];

	const observeRequest = (request: import('@playwright/test').Request) => {
		if (request.method() === 'POST' && /\/connections\/\d+\/(rdp|vnc)-session/.test(request.url())) {
			reconnectRequests.push(request.url());
		}
	};

	page.on('request', observeRequest);
	for (const cancellation of ['pointercancel', 'blur', 'hidden'] as const) {
		const bounds = await resizeHandle.boundingBox();
		expect(bounds).toBeTruthy();
		await resizeHandle.dispatchEvent('pointerdown', {
			pointerId: 23,
			pointerType: 'pen',
			isPrimary: true,
			button: 0,
			clientX: bounds!.x,
			clientY: bounds!.y,
		});
		await page.evaluate((cancellation) => {
			window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 23, clientX: 700, clientY: 500 }));
			if (cancellation === 'hidden') {
				Object.defineProperty(document, 'hidden', { configurable: true, value: true });
				document.dispatchEvent(new Event('visibilitychange'));
				Reflect.deleteProperty(document, 'hidden');
				document.dispatchEvent(new Event('visibilitychange'));
			} else if (cancellation === 'blur') {
				window.dispatchEvent(new Event('blur'));
			} else {
				window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 23 }));
			}
		}, cancellation);
		await expect.poll(() => page.evaluate(() => document.body.style.userSelect)).toBe(originalSelection);
		const cancelledBox = await panel.boundingBox();
		await page.evaluate(() => {
			window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 23, clientX: 1000, clientY: 700 }));
			window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 23 }));
		});
		expect(await panel.boundingBox()).toEqual(cancelledBox);
		expect(await getUiPreferences(page.request)).toEqual(savedPreferences);
	}

	for (const viewport of [
		{ width: 390, height: 400 },
		{ width: 320, height: 240 },
	]) {
		await page.setViewportSize(viewport);
		await expect
			.poll(async () => {
				const bounds = await panel.boundingBox();
				return Boolean(
					bounds &&
					bounds.x >= 0 &&
					bounds.y >= 0 &&
					bounds.x + bounds.width <= viewport.width + 1 &&
					bounds.y + bounds.height <= viewport.height + 1,
				);
			})
			.toBe(true);
		await revealDesktopControls(page);
		if (protocol === 'RDP') await expectRdpToolbarLayout(panel);
		await expect(panel.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
		await expect(panel).toContainText('Connected');
	}
	// Leave the small viewport's chrome before moving the window back underneath the pointer.
	await page.mouse.move(0, 0);
	await page.setViewportSize(originalViewport!);
	await revealDesktopControls(page);
	await panel.getByRole('button', { name: 'Minimize', exact: true }).click();
	await expect(restore).toBeVisible();
	await dragBy(page, restore, 1200, 800);
	await page.setViewportSize({ width: 390, height: 400 });
	if (protocol === 'RDP') {
		await expect(restore).toHaveAttribute('data-dock', 'right');
		await expect(restore.locator('..')).toBeInViewport({ ratio: 1 });
	} else {
		await expect(restore).toBeInViewport({ ratio: 1 });
	}
	// Consume the original drag's synthetic click before intentionally restoring.
	await restore.dispatchEvent('click', { detail: 1 });
	await restore.click();
	await expect(panel).toBeVisible();
	expect(await getUiPreferences(page.request)).toEqual(savedPreferences);
	await page.setViewportSize(originalViewport!);
	page.off('request', observeRequest);
	expect(reconnectRequests).toEqual([]);
}

async function closeDesktopDuringResize(page: Page): Promise<void> {
	const panel = remoteWindow(page);
	const preferences = await getUiPreferences(page.request);
	const originalSelection = await page.evaluate(() => document.body.style.userSelect);
	await revealDesktopControls(page);
	const resize = panel.getByLabel('Resize window', { exact: true });
	const bounds = await resize.boundingBox();
	expect(bounds).toBeTruthy();
	await resize.dispatchEvent('pointerdown', {
		pointerId: 31,
		isPrimary: true,
		button: 0,
		clientX: bounds!.x,
		clientY: bounds!.y,
	});
	await page.evaluate(() => {
		window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 31, clientX: 800, clientY: 600 }));
	});
	// Closing the owner cancels its still-active pointer; it must not commit a size.
	await panel.getByRole('button', { name: 'Close', exact: true }).dispatchEvent('click');
	await expect(panel).toBeHidden();
	await expect.poll(() => page.evaluate(() => document.body.style.userSelect)).toBe(originalSelection);
	expect(await getUiPreferences(page.request)).toEqual(preferences);
}

test('RDP pointer resize and restore-button dragging preserve minimized window behavior', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await page.setViewportSize({ width: 1600, height: 1100 });
	await updateUiPreferences(context.request, (preferences) => {
		preferences.language = 'en-US';
		preferences.rdpModalWidth = 900;
		preferences.rdpModalHeight = 560;
	});

	const connectionId = await createRemoteConnection(
		context.request,
		'RDP',
		POINTER_RDP_NAME,
		'127.0.0.1',
		E2E_PORTS.rdp,
	);
	try {
		await openRemoteConnection(page, POINTER_RDP_NAME);
		await expect(remoteWindow(page)).toHaveCSS('width', '900px');
		await expect(remoteWindow(page)).toHaveCSS('height', '560px');
		await exercisePointerWindow(page);
		await closeDesktopDuringResize(page);
	} finally {
		await context.request.delete(`/api/v1/targets/connections/${connectionId}`, {
			headers: { Origin: E2E_URLS.frontendOrigin },
		});
	}
});

test.describe('RDP docked restore on touch screens', () => {
	test.use({ hasTouch: true });

	test('compact controls stay on one row and docked taps tolerate touch movement', async ({ page, context }) => {
		await loginAsInitialAdmin(context.request);
		await page.setViewportSize({ width: 820, height: 1180 });
		await updateUiPreferences(context.request, (preferences) => {
			preferences.language = 'en-US';
		});
		const name = 'E2E RDP Docked Touch';
		const connectionId = await createRemoteConnection(context.request, 'RDP', name, '127.0.0.1', E2E_PORTS.rdp);
		const cdp = await context.newCDPSession(page);

		const touch = async (x: number, y: number, deltaX: number, deltaY: number) => {
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: [{ x: x + deltaX, y: y + deltaY, id: 1 }],
			});
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		};

		try {
			await openRemoteConnection(page, name);
			const panel = remoteWindow(page);
			await expect(panel).toContainText('Connected', { timeout: 15_000 });
			// Desktop UA with touch covers tablets which request desktop websites.
			for (const width of [820, 390, 320]) {
				await step(`single-row touch toolbar and restore at ${width}px`, async () => {
					await page.setViewportSize({ width, height: 780 });
					await revealDesktopControls(page, true);
					await expectRdpToolbarLayout(panel, true);
					await panel.getByRole('button', { name: 'Touch', exact: true }).tap();
					const touchPanel = page.getByRole('dialog', { name: 'Touch', exact: true });
					await expect(touchPanel.getByRole('group', { name: 'Touch', exact: true })).toBeVisible();
					for (const mode of ['Touchpad', 'Direct']) {
						const button = touchPanel.getByRole('button', { name: mode, exact: true });
						await button.tap();
						await expect(button).toHaveAttribute('aria-pressed', 'true');
					}
					await page.keyboard.press('Escape');
					await expect(touchPanel).toBeHidden();
					await expect(panel.getByRole('button', { name: 'Touch', exact: true })).toBeFocused();
					await panel.getByRole('button', { name: 'Window size', exact: true }).tap();
					const sizePanel = page.getByRole('dialog', { name: 'Window size', exact: true });
					await expect(sizePanel.getByRole('spinbutton', { name: 'Width', exact: true })).toBeVisible();
					await expect(sizePanel.getByRole('spinbutton', { name: 'Height', exact: true })).toBeVisible();
					const sizeBox = await sizePanel.boundingBox();
					expect(sizeBox).toBeTruthy();
					expect(sizeBox!.x).toBeGreaterThanOrEqual(0);
					expect(sizeBox!.x + sizeBox!.width).toBeLessThanOrEqual(width);
					await page.keyboard.press('Escape');
					await expect(sizePanel).toBeHidden();
					await panel.getByRole('button', { name: 'File clipboard', exact: true }).tap();
					const files = page.getByRole('dialog', { name: 'File clipboard', exact: true });
					await expect(files).toBeVisible();
					await files.getByRole('button', { name: 'Close', exact: true }).tap();

					const restore = page.getByRole('button', { name: 'Restore remote desktop window', exact: true });
					for (const jitter of [1, 4]) {
						await revealDesktopControls(page, true);
						await panel.getByRole('button', { name: 'Minimize', exact: true }).tap();
						await expect(restore).toBeVisible();
						const anchor = await restore.locator('..').boundingBox();
						expect(anchor).toBeTruthy();
						const right = (await restore.getAttribute('data-dock')) === 'right';
						await touch(
							right ? anchor!.x + anchor!.width - 12 : anchor!.x + 12,
							anchor!.y + 25,
							jitter,
							jitter,
						);
						await expect(panel).toBeVisible();
						await expect(restore).toBeHidden();
					}

					await revealDesktopControls(page, true);
					await panel.getByRole('button', { name: 'Minimize', exact: true }).tap();
					const anchor = await restore.locator('..').boundingBox();
					expect(anchor).toBeTruthy();
					const right = (await restore.getAttribute('data-dock')) === 'right';
					const startX = right ? anchor!.x + anchor!.width - 12 : anchor!.x + 12;
					const endX = right ? 12 : width - 12;
					await touch(startX, anchor!.y + 25, endX - startX, 40);
					await expect(panel).toBeHidden();
					await expect(restore).toHaveAttribute('data-dock', right ? 'left' : 'right');
					const docked = await restore.locator('..').boundingBox();
					expect(docked).toBeTruthy();
					await touch(right ? docked!.x + 12 : docked!.x + docked!.width - 12, docked!.y + 25, 1, 1);
					await expect(panel).toBeVisible();
					await expect(panel).toContainText('Connected');
				});
			}
			await step('typing a new size preserves focus across the compact layout boundary', async () => {
				await page.setViewportSize({ width: 1440, height: 1000 });
				await revealDesktopControls(page, true);
				await panel.getByRole('button', { name: 'Window size', exact: true }).tap();
				const sizePanel = page.getByRole('dialog', { name: 'Window size', exact: true });
				const compactWidth = sizePanel.getByRole('spinbutton', { name: 'Width', exact: true });
				const before = await panel.boundingBox();
				await compactWidth.focus();
				await compactWidth.press('Control+A');
				await compactWidth.pressSequentially('1064');
				await expect(compactWidth).toBeFocused();
				expect(await panel.boundingBox()).toEqual(before);
				await compactWidth.press('Tab');
				await expect(sizePanel).toBeHidden();
				await revealDesktopControls(page, true);
				const inlineWidth = panel.getByRole('spinbutton', { name: 'Width', exact: true });
				await expect(inlineWidth).toBeEnabled();
				await inlineWidth.focus();
				await inlineWidth.press('Control+A');
				await inlineWidth.pressSequentially('1200');
				await expect(inlineWidth).toBeFocused();
				await expect(inlineWidth).toHaveValue('1200');
				expect((await panel.boundingBox())!.width).toBe(1064);
				await inlineWidth.press('Tab');
				await expect
					.poll(async () => (await getUiPreferences(context.request)).preferences.rdpModalWidth)
					.toBe(1200);
			});
			await revealDesktopControls(page, true);
			await panel.getByRole('button', { name: 'Close', exact: true }).tap();
		} finally {
			await cdp.detach();
			await context.request.delete(`/api/v1/targets/connections/${connectionId}`, {
				headers: { Origin: E2E_URLS.frontendOrigin },
			});
		}
	});
});

test('VNC pointer resize and restore-button dragging share the same window semantics', async ({ page, context }) => {
	const remoteFrames: Array<string | Buffer> = [];
	page.on('websocket', (socket) => {
		socket.on('framesent', (event) => remoteFrames.push(event.payload));
	});
	await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: E2E_URLS.frontendOrigin });
	await loginAsInitialAdmin(context.request);
	await page.setViewportSize({ width: 1600, height: 1100 });
	await updateUiPreferences(context.request, (preferences) => {
		preferences.language = 'en-US';
		preferences.vncModalWidth = 900;
		preferences.vncModalHeight = 650;
	});

	const connectionId = await createRemoteConnection(
		context.request,
		'VNC',
		POINTER_VNC_NAME,
		'127.0.0.1',
		E2E_PORTS.vnc,
	);
	try {
		await step('Connections also launches VNC globally without replacing its route', async () => {
			await page.goto('/connections');
			const row = connectionCard(page, POINTER_VNC_NAME);
			await expect(row).toBeVisible();
			await row.getByRole('button', { name: 'Connect', exact: true }).click();
			await expect(page).toHaveURL(/\/connections$/);
			const modal = remoteWindow(page);
			await expect(modal).toBeVisible();
			await expect(modal).toContainText('Connected', { timeout: 15_000 });
			await revealDesktopControls(page);
			await modal.getByRole('button', { name: 'Close', exact: true }).click();
			await expect(modal).toBeHidden();
			await expect(page).toHaveURL(/\/connections$/);
		});

		await openRemoteConnection(page, POINTER_VNC_NAME);
		const vncModal = remoteWindow(page);
		await expect(vncModal).toContainText('Connected', { timeout: 15_000 });
		await expect(vncModal.locator('i.fa-plug')).toBeVisible();
		const vncText = vncModal.getByPlaceholder('Enter text here to send to VNC');
		const send = vncModal.getByRole('button', { name: 'Send', exact: true });
		await expect(vncText).toBeVisible();
		await expect(send).toBeDisabled();
		const inputText = 'VNC_E2E_INPUT_' + crypto.randomUUID();
		await vncText.fill(inputText);
		await expect(send).toBeEnabled();
		await send.click();
		await vncModal.locator('canvas').click({ position: { x: 40, y: 40 } });
		await page.keyboard.press('Enter');
		await expect
			.poll(
				async () =>
					(await (await context.request.get(E2E_URLS.desktopControlOrigin + '/e2e/desktop/input')).json())
						.text,
			)
			.toContain(inputText);

		const hostText = 'NEXUS_VNC_HOST_CLIPBOARD_E2E_' + crypto.randomUUID();
		await page.evaluate((text) => navigator.clipboard.writeText(text), hostText);
		const displayElement = vncModal.locator('.remote-display-container [tabindex="0"]').first();
		await expect(displayElement).toBeAttached();
		await displayElement.dispatchEvent('focus');
		await expect
			.poll(
				async () =>
					(await (await context.request.get(E2E_URLS.desktopControlOrigin + '/e2e/desktop/clipboard')).json())
						.text,
			)
			.toBe(hostText);
		expect(remoteFrames.some((frame) => Buffer.isBuffer(frame))).toBeTruthy();

		const remoteText = 'NEXUS_VNC_REMOTE_CLIPBOARD_E2E_' + crypto.randomUUID();
		const remoteClipboard = await context.request.post(`${E2E_URLS.desktopControlOrigin}/e2e/desktop/clipboard`, {
			data: { text: remoteText },
		});
		expect(remoteClipboard.ok()).toBeTruthy();
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 15_000 })
			.toBe(remoteText);
		await expect(vncModal).toContainText('Connected');
		await exercisePointerWindow(page);
		await closeDesktopDuringResize(page);
	} finally {
		await context.request.delete(`/api/v1/targets/connections/${connectionId}`, {
			headers: { Origin: E2E_URLS.frontendOrigin },
		});
	}
});

test('RDP reconnect cancels pending file batches and retires the previous audio context', async ({ page, context }) => {
	const readAudioStates = await observeDesktopAudioContexts(page);
	await loginAsInitialAdmin(context.request);
	await updateUiPreferences(context.request, (preferences) => {
		preferences.language = 'en-US';
	});
	let holdRemote = false;
	await page.routeWebSocket('**/ws/remote-desktop?*', (socket) => {
		const server = socket.connectToServer();
		server.onMessage((message) => {
			if (!holdRemote) socket.send(message);
		});
	});
	const name = 'E2E RDP Clipboard Lifecycle';
	const id = await createRemoteConnection(context.request, 'RDP', name, '127.0.0.1', E2E_PORTS.rdp);
	try {
		await openRemoteConnection(page, name);
		const panel = remoteWindow(page);
		await expect(panel).toContainText('Connected', { timeout: 15_000 });
		await authenticateTestRdp(page);
		await expect.poll(readAudioStates).toEqual([expect.stringMatching(/^(running|suspended)$/)]);
		await revealDesktopControls(page);
		await panel.getByRole('button', { name: 'File clipboard', exact: true }).click();
		const files = page.getByRole('dialog', { name: 'File clipboard', exact: true });
		const choose = files.getByRole('button', { name: 'Choose local files', exact: true });
		await expect(choose).toBeEnabled();
		// Hold real server responses after the chooser to exercise cancellation before a file target accepts it.
		holdRemote = true;
		await files.locator('input[type="file"]').setInputFiles([
			{ name: '中文-😀.txt', mimeType: 'text/plain', buffer: Buffer.from('file clipboard') },
			{ name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) },
		]);
		await expect(choose).toBeDisabled();
		await expect(files.getByRole('status')).toContainText('Files are ready');
		await files.getByRole('button', { name: 'Close', exact: true }).click();
		await revealDesktopControls(page);
		holdRemote = false;
		await panel.getByRole('button', { name: 'Reconnect', exact: true }).click();
		await expect(panel).toContainText('Connected', { timeout: 15_000 });
		await authenticateTestRdp(page);
		await expect.poll(readAudioStates).toEqual(['closed', expect.stringMatching(/^(running|suspended)$/)]);
		await revealDesktopControls(page);
		await panel.getByRole('button', { name: 'File clipboard', exact: true }).click();
		await expect(choose).toBeEnabled();
		await expect(files.getByRole('status')).toHaveCount(0);
		await expect(files.getByRole('listitem')).toHaveCount(0);
		await files.getByRole('button', { name: 'Close', exact: true }).click();
		await revealDesktopControls(page);
		await panel.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(panel).toBeHidden();
		await expect.poll(readAudioStates).toEqual(['closed', 'closed']);
	} finally {
		holdRemote = false;
		await context.request.delete(`/api/v1/targets/connections/${id}`, {
			headers: { Origin: E2E_URLS.frontendOrigin },
		});
	}
});
