import { expect, test, type Locator } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
	configureSshE2eSettings,
	connectTestSshFromConnectionsPage,
	createTestSshConnection,
	trustTestSshHostKey,
} from '../../support/ssh';

for (const sameConnection of [false, true]) {
	test(`opening a second SSH tab for ${sameConnection ? 'the same connection' : 'another connection'} isolates the visible terminal and shell`, async ({
		page,
		context,
	}) => {
		await loginAsInitialAdmin(context.request);
		await configureSshE2eSettings(context.request);
		await trustTestSshHostKey(context.request);
		const firstId = await createTestSshConnection(context.request, 'E2E Isolated SSH A');
		const secondId = sameConnection
			? firstId
			: await createTestSshConnection(context.request, 'E2E Isolated SSH B');
		await connectTestSshFromConnectionsPage(page, firstId);
		const tabs = page.locator('.terminal-tab-shell').getByRole('tab');
		const firstTab = tabs.nth(0);
		const secondTab = tabs.nth(1);

		const selectedSurface = async (tab: Locator): Promise<Locator> => {
			await expect(tab).toHaveAttribute('aria-selected', 'true');
			await expect(tab).toHaveAttribute('data-session-state', 'connected', { timeout: 35_000 });
			const sessionId = await tab.getAttribute('data-session-id');
			if (!sessionId) throw new Error('A connected SSH tab must have a Workspace session ID');
			const visible = page.locator('[data-workspace-surface]:visible');
			await expect(visible).toHaveCount(1);
			await expect(visible).toHaveAttribute('data-workspace-id', sessionId);
			await expect(page.locator('.terminal-inner-container:visible')).toHaveCount(1);
			return page.locator(`[data-workspace-surface][data-workspace-id="${sessionId}"]`);
		};

		const typeCommand = async (surface: Locator, command: string): Promise<void> => {
			const input = surface.locator('.xterm-helper-textarea');
			await expect(input).toBeVisible();
			await input.focus();
			await page.keyboard.insertText(command);
			await page.keyboard.press('Enter');
		};

		const firstSurface = await selectedSurface(firstTab);
		const firstRows = firstSurface.locator('.xterm-rows');
		// Assemble markers in the remote shell so echoed input cannot satisfy output assertions.
		await typeCommand(firstSurface, 'NEXUS_TAB_OWNER=A; printf \'NEXUS_READY_%s\\n\' "$NEXUS_TAB_OWNER"');
		await expect(firstRows).toContainText('NEXUS_READY_A');

		await page.getByRole('button', { name: 'New Connection Tab', exact: true }).click();
		await page.locator(`.workspace-connection-list [data-connection-id="${secondId}"]`).click();
		await expect(tabs).toHaveCount(2);
		// Check automatic activation before clicking either tab: this is the reported entry path.
		const secondSurface = await selectedSurface(secondTab);
		expect(await secondTab.getAttribute('data-session-id')).not.toBe(
			await firstTab.getAttribute('data-session-id'),
		);
		await expect(firstSurface).toBeHidden();
		const secondRows = secondSurface.locator('.xterm-rows');
		await typeCommand(secondSurface, 'printf \'NEXUS_INITIAL_%s\\n\' "${NEXUS_TAB_OWNER:-unset}"');
		await expect(secondRows).toContainText('NEXUS_INITIAL_unset');
		await typeCommand(secondSurface, 'NEXUS_TAB_OWNER=B; printf \'NEXUS_READY_%s\\n\' "$NEXUS_TAB_OWNER"');
		await expect(secondRows).toContainText('NEXUS_READY_B');
		await expect(secondRows).not.toContainText('NEXUS_READY_A');

		for (const [index, owner] of ['A', 'B', 'A', 'B'].entries()) {
			const tab = owner === 'A' ? firstTab : secondTab;
			await tab.click();
			const surface = await selectedSurface(tab);
			await expect(owner === 'A' ? secondSurface : firstSurface).toBeHidden();
			const commandInput = surface.locator('input.command-bar-input');
			await expect(commandInput).toBeEnabled();
			await commandInput.fill(`printf 'NEXUS_VISIT_${index}_%s\\n' "$NEXUS_TAB_OWNER"`);
			await commandInput.press('Enter');
			const rows = surface.locator('.xterm-rows');
			await expect(rows).toContainText(`NEXUS_VISIT_${index}_${owner}`);
			await expect(rows).not.toContainText(`NEXUS_READY_${owner === 'A' ? 'B' : 'A'}`);
		}

		await secondTab.getByRole('button', { name: 'Close Tab', exact: true }).click();
		await expect(tabs).toHaveCount(1);
		await selectedSurface(firstTab);
		await expect(secondSurface).toHaveCount(0);
		await typeCommand(firstSurface, 'printf \'NEXUS_SURVIVOR_%s\\n\' "$NEXUS_TAB_OWNER"');
		await expect(firstRows).toContainText('NEXUS_SURVIVOR_A');
	});
}

for (const mobile of [false, true]) {
	test.describe(mobile ? 'mobile pending connection selection' : 'desktop pending connection selection', () => {
		test.use(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {});
		test('finishing a background SSH handshake preserves the selected tab and a newly opened picker', async ({
			page,
			context,
		}) => {
			await loginAsInitialAdmin(context.request);
			await configureSshE2eSettings(context.request);
			await trustTestSshHostKey(context.request);
			const selectedId = await createTestSshConnection(context.request, 'E2E Existing Selection');
			const pendingId = await createTestSshConnection(context.request, 'E2E Handshake Pending');
			let release: (() => void) | undefined;
			await page.routeWebSocket('**/ws/workspace', (socket) => {
				const server = socket.connectToServer();
				socket.onMessage((message) => {
					if (typeof message === 'string') {
						const frame = JSON.parse(message);
						if (frame.type === 'workspace.connect' && frame.payload?.connectionId === pendingId) {
							release = () => server.send(message);
							return;
						}
					}
					server.send(message);
				});
			});
			await connectTestSshFromConnectionsPage(page, selectedId);
			await page.getByRole('button', { name: 'New Connection Tab', exact: true }).click();
			await page.locator(`.workspace-connection-list [data-connection-id="${pendingId}"]`).click();
			await expect.poll(() => Boolean(release)).toBe(true);
			const tabs = page.locator('.terminal-tab-shell').getByRole('tab');
			const selected = tabs.filter({ hasText: 'E2E Existing Selection' });
			const pending = tabs.filter({ hasText: 'E2E Handshake Pending' });
			await selected.click();
			await expect(selected).toHaveAttribute('aria-selected', 'true');
			await page.getByRole('button', { name: 'New Connection Tab', exact: true }).click();
			release?.();
			await expect(pending).toHaveAttribute('data-session-state', 'connected', { timeout: 35_000 });
			await expect(selected).toHaveAttribute('aria-selected', 'true');
			await expect(page.getByRole('heading', { name: 'New session', exact: true })).toBeVisible();
			await selected.click();
			await expect(page.locator('.terminal-inner-container:visible')).toHaveCount(1);
		});
		for (const batch of [false, true]) {
			test(`a delayed ${batch ? 'batch' : 'single'} connection cannot override a newer selection`, async ({
				page,
				context,
			}) => {
				await loginAsInitialAdmin(context.request);
				await configureSshE2eSettings(context.request);
				await trustTestSshHostKey(context.request);
				const firstId = await createTestSshConnection(context.request, 'E2E 01 Pending First');
				const selectedId = await createTestSshConnection(context.request, 'E2E 03 Latest Selection');
				if (batch) await createTestSshConnection(context.request, 'E2E 02 Queued Connection');

				let release = () => {};

				const held = new Promise<void>((resolve) => {
					release = resolve;
				});

				let requested = () => {};

				const requestStarted = new Promise<void>((resolve) => {
					requested = resolve;
				});
				await page.route(`**/api/v1/targets/connections/${firstId}`, async (route) => {
					const response = await route.fetch();
					requested();
					await held;
					await route.fulfill({ response });
				});
				try {
					await page.goto('/connections');
					const firstRow = page.locator('.connection-card').filter({ hasText: 'E2E 01 Pending First' });
					await expect(firstRow).toBeVisible();
					if (batch) await page.getByRole('button', { name: 'Connect All', exact: true }).click();
					else await firstRow.getByRole('button', { name: 'Connect', exact: true }).click();
					await requestStarted;
					await page.locator(`.workspace-connection-list [data-connection-id="${selectedId}"]`).click();
					const tabs = page.locator('.terminal-tab-shell').getByRole('tab');
					const selected = tabs.filter({ hasText: 'E2E 03 Latest Selection' }).first();
					await expect(selected).toHaveAttribute('aria-selected', 'true');
					await expect(selected).toHaveAttribute('data-session-state', 'connected', { timeout: 35_000 });
					const sessionId = await selected.getAttribute('data-session-id');
					if (!sessionId) throw new Error('Selected Workspace must have a session ID');
					release();
					await expect(tabs).toHaveCount(batch ? 4 : 2);
					for (const tab of await tabs.all()) {
						await expect(tab).toHaveAttribute('data-session-state', 'connected', { timeout: 35_000 });
					}
					await expect(page.locator(`.terminal-tab-shell [data-session-id="${sessionId}"]`)).toHaveAttribute(
						'aria-selected',
						'true',
					);
					await expect(page.locator('[data-workspace-surface]:visible')).toHaveAttribute(
						'data-workspace-id',
						sessionId,
					);
					const first = tabs.filter({ hasText: 'E2E 01 Pending First' });
					await first.click();
					await expect(first).toHaveAttribute('aria-selected', 'true');
					const command = page.locator('input.command-bar-input:visible');
					await command.fill("printf 'BACKGROUND_%s\\n' READY");
					await command.press('Enter');
					await expect(page.locator('.terminal-inner-container:visible .xterm-rows')).toContainText(
						'BACKGROUND_READY',
					);
				} finally {
					release();
				}
			});
		}
	});
}
