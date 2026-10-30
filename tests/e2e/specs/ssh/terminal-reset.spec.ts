import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
	configureSshE2eSettings,
	connectTestSshFromConnectionsPage,
	createTestSshConnection,
	trustTestSshHostKey,
} from '../../support/ssh';

test('terminal reset requires confirmation and replaces only the target remote shell', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await trustTestSshHostKey(context.request);
	const connectionId = await createTestSshConnection(context.request, 'E2E Reset Terminal');
	await connectTestSshFromConnectionsPage(page, connectionId);
	const tabs = page.locator('.terminal-tab-shell').getByRole('tab');
	const oldId = await tabs.nth(0).getAttribute('data-session-id');
	if (!oldId) throw new Error('Connected terminal must have a Workspace ID');
	const oldSurface = page.locator(`[data-workspace-surface][data-workspace-id="${oldId}"]`);
	await oldSurface.locator('input.command-bar-input').fill('NEXUS_RESET_OWNER=old');
	await oldSurface.locator('input.command-bar-input').press('Enter');

	await page.getByRole('button', { name: 'New Connection Tab', exact: true }).click();
	await page.locator(`.workspace-connection-list [data-connection-id="${connectionId}"]`).click();
	await expect(tabs).toHaveCount(2);
	await expect(tabs.nth(1)).toHaveAttribute('data-session-state', 'connected', { timeout: 35_000 });
	const otherId = await tabs.nth(1).getAttribute('data-session-id');
	if (!otherId) throw new Error('Second terminal must have a Workspace ID');
	const otherSurface = page.locator(`[data-workspace-surface][data-workspace-id="${otherId}"]`);
	await otherSurface.locator('input.command-bar-input').fill('NEXUS_RESET_OWNER=other');
	await otherSurface.locator('input.command-bar-input').press('Enter');

	await tabs.nth(0).click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Reset Terminal', exact: true }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(tabs.nth(0)).toHaveAttribute('data-session-id', oldId);
	await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
	await expect(tabs.nth(0)).toHaveAttribute('data-session-state', 'connected');

	// Reset a background tab while its foreground command is waiting. The other tab stays active.
	await tabs.nth(0).click();
	await oldSurface.locator('input.command-bar-input').fill("printf 'NEXUS_%s\\n' RESET_WAITING; cat");
	await oldSurface.locator('input.command-bar-input').press('Enter');
	await expect(oldSurface.locator('.xterm-rows')).toContainText('NEXUS_RESET_WAITING');
	await tabs.nth(1).click();
	await tabs.nth(0).click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Reset Terminal', exact: true }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
	await expect(tabs.nth(0)).not.toHaveAttribute('data-session-id', oldId);
	await expect(tabs).toHaveCount(2);
	await expect(tabs.nth(0)).toHaveAttribute('data-session-state', 'connected', { timeout: 35_000 });
	await expect(tabs.nth(1)).toHaveAttribute('data-session-id', otherId);
	await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
	await expect(oldSurface).toHaveCount(0);

	await otherSurface.locator('input.command-bar-input').fill('printf \'NEXUS_SURVIVOR_%s\\n\' "$NEXUS_RESET_OWNER"');
	await otherSurface.locator('input.command-bar-input').press('Enter');
	await expect(otherSurface.locator('.xterm-rows')).toContainText('NEXUS_SURVIVOR_other');
	await tabs.nth(0).click();
	const newId = await tabs.nth(0).getAttribute('data-session-id');
	const newSurface = page.locator(`[data-workspace-surface][data-workspace-id="${newId}"]`);
	await newSurface
		.locator('input.command-bar-input')
		.fill('printf \'NEXUS_FRESH_%s\\n\' "${NEXUS_RESET_OWNER:-unset}"');
	await newSurface.locator('input.command-bar-input').press('Enter');
	await expect(newSurface.locator('.xterm-rows')).toContainText('NEXUS_FRESH_unset');
	await tabs.nth(0).getByRole('button', { name: 'Close Tab', exact: true }).click();
	await tabs.nth(0).getByRole('button', { name: 'Close Tab', exact: true }).click();
	await expect(tabs).toHaveCount(0);
});
