import { expect, test, type Locator } from '../../support/fixtures';
import { getUiPreferences, loginAsInitialAdmin, updateUiPreferences } from '../../support/auth';
import { getTestSidebar, updateTestSidebar } from '../../support/presentation';
import {
	closeConnectedFileManager,
	configureSshE2eSettings,
	connectTestSshFromConnectionsPage,
	ensureTestSshConnection,
	fileManagerRow,
	openConnectedFileManager,
	reopenConnectedFileManager,
	resetTestSshFilesystem,
	setTestSshOnline,
} from '../../support/ssh';

test.use({ e2eServices: ['ssh'] });

test('file manager width follows the pointer across toolbar wrapping and preserves its minimum', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await resetTestSshFilesystem();
	await page.setViewportSize({ width: 1440, height: 900 });
	const connectionId = await ensureTestSshConnection(context.request);
	await connectTestSshFromConnectionsPage(page, connectionId);
	await openConnectedFileManager(page);
	const panel = page.getByRole('dialog', { name: 'File Manager', exact: true });
	const root = panel.locator('.file-manager-root');
	const actions = panel.locator('.file-manager-actions');
	await expect(actions.locator('button')).toHaveCount(8);
	const initial = await panel.boundingBox();
	const handle = await panel.getByLabel('Resize file manager window', { exact: true }).boundingBox();
	if (!initial || !handle) throw new Error('File manager resize geometry is missing');
	const startX = handle.x + handle.width / 2;
	const startY = handle.y + handle.height / 2;
	await page.mouse.move(startX, startY);
	await page.mouse.down();
	try {
		// Use one uninterrupted drag in both directions. Checking only mouseup
		// misses the live snap plateau around the single-row and minimum widths.
		for (const requestedWidth of [
			310, 292, 282, 272, 264, 254, 238, 220, 198, 180, 170, 158, 176, 206, 250, 282, 310,
		]) {
			await page.mouse.move(startX + (requestedWidth - initial.width) / 2, startY);
			const expectedWidth = Math.max(170, requestedWidth);
			await expect
				.poll(async () => Math.abs(((await panel.boundingBox())?.width ?? 0) - expectedWidth))
				.toBeLessThanOrEqual(1);
			const availableWidth = await root.evaluate((element) => element.clientWidth);
			const expectedRows = availableWidth >= 262 ? [8] : [4, 4];
			await expect
				.poll(() =>
					actions.evaluate((element) => {
						const rows = new Map<number, number>();
						for (const button of element.querySelectorAll('button')) {
							const top = Math.round(button.getBoundingClientRect().top);
							rows.set(top, (rows.get(top) ?? 0) + 1);
						}
						return [...rows.values()];
					}),
				)
				.toEqual(expectedRows);
			const geometry = await actions.evaluate((element) => ({
				overflow: element.scrollWidth - element.clientWidth,
				minimumButtonWidth: Math.min(
					...Array.from(element.querySelectorAll('button'), (button) => button.getBoundingClientRect().width),
				),
			}));
			expect(geometry.overflow).toBeLessThanOrEqual(1);
			expect(geometry.minimumButtonWidth).toBeGreaterThanOrEqual(28);
		}
	} finally {
		await page.mouse.up();
	}
	await expect.poll(async () => Math.abs(((await panel.boundingBox())?.width ?? 0) - 310)).toBeLessThanOrEqual(1);
	await closeConnectedFileManager(page);
	await reopenConnectedFileManager(page);
	await expect.poll(async () => Math.abs(((await panel.boundingBox())?.width ?? 0) - 310)).toBeLessThanOrEqual(1);
});

test('file column resize releases the pointer on disconnect without saving a stale width', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await updateUiPreferences(context.request, (preferences) => {
		preferences.fileManagerColWidths = { name: 200, permissions: 98, modified: 136 };
	});
	await resetTestSshFilesystem();
	await page.setViewportSize({ width: 1440, height: 900 });
	const connectionId = await ensureTestSshConnection(context.request);
	await connectTestSshFromConnectionsPage(page, connectionId);
	await openConnectedFileManager(page);
	const panel = page.getByRole('dialog', { name: 'File Manager', exact: true });
	const handle = panel.locator('.file-column-resizer').first();
	await expect(handle).toBeVisible();
	const initialWidths = (await getUiPreferences(context.request)).preferences.fileManagerColWidths;
	const savedPreferences: string[] = [];
	page.on('request', (request) => {
		if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/v1/settings/preferences') {
			savedPreferences.push(request.postData() ?? '');
		}
	});
	const previousBodyStyle = await page.evaluate(() => {
		const previous = { cursor: document.body.style.cursor, userSelect: document.body.style.userSelect };
		document.body.style.cursor = 'crosshair';
		document.body.style.userSelect = 'text';
		return previous;
	});
	try {
		for (const cancellation of ['pointercancel', 'blur', 'hidden']) {
			await handle.dispatchEvent('pointerdown', { isPrimary: true, pointerId: 70, clientX: 200 });
			await page.evaluate(() => {
				window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 70, clientX: 220 }));
				window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 999 }));
			});
			await expect(page.locator('body')).toHaveCSS('cursor', 'col-resize');
			await page.evaluate((cancellation) => {
				if (cancellation === 'pointercancel') {
					window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 70 }));
				} else if (cancellation === 'blur') {
					window.dispatchEvent(new Event('blur'));
				} else {
					const previous = Object.getOwnPropertyDescriptor(document, 'hidden');
					try {
						Object.defineProperty(document, 'hidden', { configurable: true, value: true });
						document.dispatchEvent(new Event('visibilitychange'));
					} finally {
						if (previous) Object.defineProperty(document, 'hidden', previous);
						else Reflect.deleteProperty(document, 'hidden');
					}
				}
				window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 70 }));
			}, cancellation);
			await expect(page.locator('body')).toHaveCSS('cursor', 'crosshair');
			await expect(page.locator('body')).toHaveCSS('user-select', 'text');
			expect((await getUiPreferences(context.request)).preferences.fileManagerColWidths).toEqual(initialWidths);
			expect(savedPreferences).toEqual([]);
		}
		await handle.dispatchEvent('pointerdown', { isPrimary: true, pointerId: 71, clientX: 200 });
		await page.evaluate(() =>
			window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 71, clientX: 240 })),
		);
		await expect(page.locator('body')).toHaveCSS('cursor', 'col-resize');
		await expect(page.locator('body')).toHaveCSS('user-select', 'none');

		await setTestSshOnline(false);
		await expect(page.locator('.terminal-tab-shell').getByRole('tab', { selected: true })).not.toHaveAttribute(
			'data-session-state',
			'connected',
		);
		await expect(page.locator('body')).toHaveCSS('cursor', 'crosshair');
		await expect(page.locator('body')).toHaveCSS('user-select', 'text');
		await page.evaluate(() => {
			window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 71, clientX: 800 }));
			window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 71, clientX: 800 }));
		});
		expect((await getUiPreferences(context.request)).preferences.fileManagerColWidths).toEqual(initialWidths);
		expect(savedPreferences).toEqual([]);
	} finally {
		await setTestSshOnline(true);
		await page.evaluate((previous) => {
			document.body.style.cursor = previous.cursor;
			document.body.style.userSelect = previous.userSelect;
		}, previousBodyStyle);
	}

	// The next live gesture still commits through the real preference endpoint.
	await expect(page.locator('.terminal-tab-shell').getByRole('tab', { selected: true })).toHaveAttribute(
		'data-session-state',
		'connected',
		{ timeout: 30_000 },
	);
	await expect(handle).toBeVisible();
	await handle.dispatchEvent('pointerdown', { isPrimary: true, pointerId: 72, clientX: 240 });
	await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 72, clientX: 270 })));
	const saved = page.waitForResponse(
		(response) =>
			response.request().method() === 'PUT' &&
			new URL(response.url()).pathname === '/api/v1/settings/preferences',
	);
	await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 72, clientX: 270 })));
	expect((await saved).ok()).toBe(true);
	expect(savedPreferences).toHaveLength(1);
	expect((await getUiPreferences(context.request)).preferences.fileManagerColWidths).not.toEqual(initialWidths);
});

test('switching sessions cancels popup and sidebar resizing before a late pointer release', async ({
	page,
	context,
}) => {
	test.setTimeout(90_000);
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	const originalSidebar = (await getTestSidebar(context.request)).sidebar;
	await updateTestSidebar(context.request, { left: ['quickCommands'], right: ['commandHistory'] });
	try {
		await resetTestSshFilesystem();
		await page.setViewportSize({ width: 1440, height: 900 });
		const connectionId = await ensureTestSshConnection(context.request);
		await connectTestSshFromConnectionsPage(page, connectionId);
		const tabs = page.locator('.terminal-tab-shell').getByRole('tab');
		const firstTab = tabs.nth(0);
		await page.getByRole('button', { name: 'New Connection Tab', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'New session', exact: true })).toBeVisible();
		await page.locator(`.workspace-connection-list [data-connection-id="${connectionId}"]`).click();
		await expect(tabs).toHaveCount(2);
		const secondTab = tabs.nth(1);
		await expect(secondTab).toHaveAttribute('data-session-state', 'connected', { timeout: 20_000 });
		await firstTab.click();
		const workspaceId = await page
			.locator('[data-workspace-surface][data-workspace-active="true"]')
			.getAttribute('data-workspace-id');
		if (!workspaceId) throw new Error('Active workspace identity is missing');
		const surface = page.locator(`[data-workspace-surface][data-workspace-id="${workspaceId}"]`);

		const popupStorage = () =>
			page.evaluate(() =>
				Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.includes('popup-size'))),
			);

		const preferenceWrites: string[] = [];
		page.on('request', (request) => {
			if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/v1/settings/preferences')
				preferenceWrites.push(request.postData() ?? '');
		});

		const switchDuringResize = async (handle: Locator): Promise<void> => {
			await expect(handle).toBeVisible();
			const stored = await popupStorage();
			const before = await getUiPreferences(context.request);
			const bodyUserSelect = await page.evaluate(() => document.body.style.userSelect);
			await handle.dispatchEvent('pointerdown', { isPrimary: true, pointerId: 91, clientX: 300, clientY: 300 });
			await page.evaluate(() =>
				window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 91, clientX: 340, clientY: 330 })),
			);
			await expect(page.locator('body')).toHaveCSS('user-select', 'none');
			// A real tab activation changes the cached surface's active prop without unmounting it.
			await secondTab.dispatchEvent('click');
			await expect(secondTab).toHaveAttribute('aria-selected', 'true');
			await expect.poll(() => page.evaluate(() => document.body.style.userSelect)).toBe(bodyUserSelect);
			await page.evaluate(() => {
				window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 91, clientX: 700, clientY: 700 }));
				window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 91, clientX: 700, clientY: 700 }));
			});
			expect(await popupStorage()).toEqual(stored);
			expect((await getUiPreferences(context.request)).preferences.sidebarPaneWidths).toEqual(
				before.preferences.sidebarPaneWidths,
			);
			expect(preferenceWrites).toEqual([]);
			await firstTab.dispatchEvent('click');
			await expect(firstTab).toHaveAttribute('aria-selected', 'true');
		};

		await openConnectedFileManager(page);
		const manager = page.getByRole('dialog', { name: 'File Manager', exact: true });
		await switchDuringResize(manager.getByLabel('Resize file manager window', { exact: true }));
		await fileManagerRow(page, 'seed.txt').dblclick();
		const documents = page.locator(`[data-document-mode][data-workspace-id="${workspaceId}"]`);
		await expect(documents.locator('.file-editor-container')).toBeVisible();
		await switchDuringResize(documents.locator('.document-popup-resize-handle'));
		if (await documents.isVisible()) await documents.click({ position: { x: 2, y: 2 } });
		await expect(documents).toBeHidden();

		await fileManagerRow(page, 'README-e2e.md').dblclick();
		await expect(documents.getByRole('heading', { name: 'Nexus Markdown E2E' })).toBeVisible();
		await switchDuringResize(documents.locator('.document-popup-resize-handle'));
		if (await documents.isVisible()) await documents.click({ position: { x: 2, y: 2 } });
		await expect(documents).toBeHidden();
		await closeConnectedFileManager(page);

		await surface.getByRole('button', { name: 'Quick Commands', exact: true }).click();
		await switchDuringResize(surface.locator('aside[data-workspace-sidebar].left-0 > .cursor-col-resize'));
		await surface.getByRole('button', { name: 'Command History', exact: true }).click();
		await switchDuringResize(surface.locator('aside[data-workspace-sidebar].right-0 > .cursor-col-resize'));
	} finally {
		await updateTestSidebar(context.request, originalSidebar);
	}
});
