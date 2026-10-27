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
