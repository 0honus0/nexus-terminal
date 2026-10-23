import { authenticateTestRdp, observeDesktopBinaryTraffic } from '../../support/desktop';
import { readConnectionList } from '../../../../packages/shared/src/targets/connections/http-codec';
import { readTestConnectionImportId } from '../../support/targets';
import { expect, test, type APIRequestContext, type Locator, type Page } from '../../support/fixtures';
import { getUiPreferences, loginAsInitialAdmin, updateUiPreferences } from '../../support/auth';
import { step } from '../../support/steps';
import { E2E_URLS, E2E_PORTS } from '../../support/test-env';

const CONNECTION_NAME = 'E2E RDP Browser';

const remoteWindow = (page: Page): Locator => page.locator('.remote-desktop-panel');

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

			const createPromise = page.waitForResponse(
				(response) =>
					response.url().endsWith('/api/v1/targets/connections/import') &&
					response.request().method() === 'POST',
			);
			await form.locator('button[type="submit"]').click();
			const createResponse = await createPromise;
			expect(createResponse.status()).toBe(200);
			connectionId = readTestConnectionImportId(await createResponse.json());
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
			const session = await context.request.post(
				`/api/v1/connections/${connectionId}/rdp-session?width=1440&height=900&dpi=120`,
				{ headers: { Origin: E2E_URLS.frontendOrigin } },
			);
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
			await expect(modal).toContainText('Connected', { timeout: 15_000 });
			await authenticateTestRdp(page);
			await expect
				.poll(async () => Number(await connectionRow.getAttribute('data-last-connected-at')), {
					timeout: 10_000,
				})
				.toBeGreaterThan(previousLastConnectedAt);
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
			await expect(modal.locator('i.fa-desktop')).toBeVisible();
			await expect(modal.locator('i.fa-expand')).toBeVisible();
			await expect(modal.locator('i.fa-window-minimize')).toBeVisible();
			await expect(modal.locator('i.fa-times')).toBeVisible();
			await expect(page.getByRole('dialog', { name: 'Progress Display', exact: true })).toHaveCount(0);
			await expect(modal).toContainText('Connected', { timeout: 15_000 });
			await authenticateTestRdp(page);
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
			const footer = panel.locator('footer');
			await expect(panel).toBeVisible();
			await expect(fullscreen).toBeVisible();
			await expect(header).toBeVisible();
			await expect(footer).toBeVisible();

			const normalBox = await panel.boundingBox();
			expect(normalBox).toBeTruthy();
			const viewport = page.viewportSize();
			expect(viewport).toBeTruthy();

			await fullscreen.click();
			await expect.poll(() => panel.evaluate((element) => document.fullscreenElement === element)).toBe(true);
			await expect(header).toBeHidden();
			await expect(footer).toBeHidden();
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
			await expect(header).toBeVisible();
			await expect(footer).toBeVisible();
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
	return readTestConnectionImportId(await response.json());
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

async function dragBy(page: Page, target: Locator, deltaX: number, deltaY: number): Promise<void> {
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
		({ x, y, id }) => {
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
				new PointerEvent('pointerup', {
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
		{ x: startX + deltaX, y: startY + deltaY, id: pointerId },
	);
}

async function exercisePointerWindow(page: Page): Promise<void> {
	const panel = remoteWindow(page);
	await expect(panel).toBeVisible();

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

	await panel.getByRole('button', { name: 'Minimize', exact: true }).click();
	await expect(panel).toBeHidden();
	const restore = page.getByRole('button', { name: 'Restore remote desktop window', exact: true });
	await expect(restore).toBeVisible();
	const initialRestoreBox = await restore.boundingBox();
	expect(initialRestoreBox).toBeTruthy();

	await dragBy(page, restore, 140, 80);
	await expect(panel).toBeHidden();
	const movedRestoreBox = await restore.boundingBox();
	expect(movedRestoreBox).toBeTruthy();
	expect(movedRestoreBox!.x).toBeGreaterThan(initialRestoreBox!.x + 80);
	expect(movedRestoreBox!.y).toBeGreaterThan(initialRestoreBox!.y + 40);

	// Browsers normally emit a click after a pointer drag on the same moving button.
	// That click must be swallowed once, while the next intentional click restores it.
	await restore.dispatchEvent('click');
	await expect(panel).toBeHidden();
	await restore.click();
	await expect(panel).toBeVisible();
	await expect(restore).toBeHidden();
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
		const modal = remoteWindow(page);
		await modal.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(modal).toBeHidden();
	} finally {
		await context.request.delete(`/api/v1/targets/connections/${connectionId}`, {
			headers: { Origin: E2E_URLS.frontendOrigin },
		});
	}
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
		const modal = remoteWindow(page);
		await modal.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(modal).toBeHidden();
	} finally {
		await context.request.delete(`/api/v1/targets/connections/${connectionId}`, {
			headers: { Origin: E2E_URLS.frontendOrigin },
		});
	}
});
