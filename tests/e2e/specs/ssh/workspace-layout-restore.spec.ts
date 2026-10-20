import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, updateUiPreferences } from '../../support/auth';
import {
	configureSshE2eSettings,
	connectTestSshFromConnectionsPage,
	ensureTestSshConnection,
	createTestSshConnection,
	E2E_SSH,
} from '../../support/ssh';
import { E2E_URLS } from '../../support/test-env';
import {
	readLayoutResponse,
	readPresentationUpdateResponse,
} from '../../../../packages/shared/src/preferences/presentation/http-codec';

test('workspace keeps the live terminal and draft cached across page navigation', async ({ page, context }) => {
	test.setTimeout(60_000);
	const geometry: Array<{ columns: number; rows: number }> = [];
	page.on('websocket', (socket) => {
		socket.on('framesent', ({ payload }) => {
			if (typeof payload !== 'string') return;
			const frame = JSON.parse(payload);
			if (frame.type === 'terminal.resize') geometry.push(frame.payload);
		});
	});
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await updateUiPreferences(context.request, (preferences) => {
		preferences.navBarVisible = true;
	});
	const beforeLayout = await context.request.get('/api/v1/settings/layout');
	expect(beforeLayout.ok()).toBeTruthy();
	const original = readLayoutResponse(await beforeLayout.json());
	const saved = await context.request.put('/api/v1/settings/workspace-layout', {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: {
			expectedVersion: original.version,
			layout: {
				id: 'restore-root',
				size: 100,
				type: 'container',
				direction: 'vertical',
				children: [
					{ id: 'restore-terminal', type: 'pane', component: 'terminal', size: 90 },
					{ id: 'restore-command', type: 'pane', component: 'commandBar', size: 10 },
				],
			},
			sidebar: { left: [], right: [] },
		},
	});
	expect(saved.ok()).toBeTruthy();
	expect(readPresentationUpdateResponse(await saved.json()).version).toBe(original.version + 1);
	const additionalName = 'E2E Cache Additional';
	await createTestSshConnection(context.request, additionalName);
	const connectionId = await ensureTestSshConnection(context.request);
	await connectTestSshFromConnectionsPage(page, connectionId);
	const terminal = page.locator('.terminal-inner-container');
	const command = page.locator('.command-bar-command-input');
	await command.fill("printf 'LAYOUT_RESTORE_READY\\n'");
	await command.press('Enter');
	await expect(terminal).toContainText('LAYOUT_RESTORE_READY');
	await expect.poll(() => geometry.length).toBeGreaterThan(0);
	const savedGeometry = geometry.at(-1)!;
	const savedBox = (await terminal.boundingBox())!;

	const originalTerminal = await terminal.elementHandle();
	const originalScreen = await terminal.locator('.xterm-screen').elementHandle();
	let workspaceLayoutReads = 0;
	await page.route('**/api/v1/settings/{layout,sidebar}', async (route) => {
		// Settings owns its own versioned editor reads. Count only requests
		// made while the cached Workspace is active.
		if (route.request().method() === 'GET' && new URL(page.url()).pathname === '/workspace')
			workspaceLayoutReads += 1;
		await route.continue();
	});
	for (const destination of ['settings', 'connections']) {
		await command.fill(`sleep 0.5; printf 'CACHE_BACKGROUND_${destination}\\n'`);
		await command.press('Enter');
		await command.fill(`draft-${destination}`);
		geometry.length = 0;
		await page.locator(`a[href="/${destination}"]`).first().click();
		await expect(page).toHaveURL(new RegExp(`/${destination}`));
		await expect(terminal).toHaveCount(0);
		await page.waitForTimeout(700);
		expect(geometry).toEqual([]);
		await page.locator('a[href="/workspace"]').first().click();
		await expect(terminal).toContainText(`CACHE_BACKGROUND_${destination}`);
		await expect(command).toHaveValue(`draft-${destination}`);
		expect(await terminal.evaluate((element, original) => element === original, originalTerminal)).toBe(true);
		expect(
			await terminal
				.locator('.xterm-screen')
				.evaluate((element, original) => element === original, originalScreen),
		).toBe(true);
		await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('data-session-state', 'connected');
		const restoredBox = (await terminal.boundingBox())!;
		expect(Math.abs(restoredBox.width - savedBox.width)).toBeLessThan(1);
		expect(Math.abs(restoredBox.height - savedBox.height)).toBeLessThan(1);
		await page.waitForTimeout(250);
		expect(
			geometry.every(
				(viewport) => viewport.columns === savedGeometry.columns && viewport.rows === savedGeometry.rows,
			),
		).toBe(true);
		expect(workspaceLayoutReads).toBe(0);
		await command.fill(`printf 'CACHE_INPUT_${destination}\\n'`);
		await command.press('Enter');
		await expect(terminal).toContainText(`CACHE_INPUT_${destination}`);
	}
	// A cached page must still consume new connection requests from the directory.
	await page.locator('a[href="/connections"]').first().click();
	await page
		.locator('.connection-card')
		.filter({ hasText: additionalName })
		.getByRole('button', { name: 'Connect', exact: true })
		.click();
	await expect(page).toHaveURL(/\/workspace$/);
	await expect(page.getByRole('tab')).toHaveCount(2);
	await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('data-session-state', 'connected', {
		timeout: 35_000,
	});
	await page.getByRole('tab').filter({ hasText: E2E_SSH.name }).click();
	await expect(page.locator('.terminal-inner-container:visible')).toContainText('CACHE_INPUT_connections');
	expect(
		await page
			.locator('.terminal-inner-container:visible')
			.evaluate((element, original) => element === original, originalTerminal),
	).toBe(true);
});
