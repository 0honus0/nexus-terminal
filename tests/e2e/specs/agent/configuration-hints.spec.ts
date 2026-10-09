import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';

test('Agent configuration hints remain closed until explicitly activated', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	const csrf = await context.request.get('/api/v1/agent/security/csrf');
	expect(csrf.ok()).toBeTruthy();
	const headers = { 'X-Nexus-CSRF': (await csrf.json()).data.token };
	const install = await context.request.post('/api/v1/agent/onboarding/recommended-plugin/install', {
		headers,
		data: {},
	});
	expect(install.ok(), await install.text()).toBeTruthy();
	const settings = await context.request.get('/api/v1/agent/settings');
	expect(settings.ok()).toBeTruthy();
	const enable = await context.request.patch('/api/v1/agent/settings', {
		headers,
		data: { expectedVersion: (await settings.json()).data.revision, patch: { feature: { enabled: true } } },
	});
	expect(enable.ok(), await enable.text()).toBeTruthy();
	await page.goto('/connections');
	await page.getByRole('button', { name: 'Open Agent', exact: true }).click();
	await page.getByRole('button', { name: 'New', exact: true }).click();

	const hub = page.locator('.agent-hub-window');
	const hintPanels = page.locator('[data-ui="info-hint-panel"]');
	for (const name of ['Execution mode', 'Approval mode']) {
		const trigger = hub.getByRole('button', { name, exact: true });
		await expect(trigger).toHaveAttribute('aria-expanded', 'false');
		await trigger.click();
		const panel = page.getByRole('dialog', { name, exact: true });
		await expect(panel).toBeVisible();
		const hint = panel.locator('[data-ui="info-hint"]');
		await expect(hint).toBeFocused();
		await expect(hint).toHaveAttribute('aria-expanded', 'false');
		await expect(hintPanels).toHaveCount(0);
		await hint.hover();
		// Exceed the normal hover delay to verify the hint never auto-opens.
		await page.waitForTimeout(250);
		await expect(hintPanels).toHaveCount(0);

		await hint.click();
		await expect(hint).toHaveAttribute('aria-expanded', 'true');
		await expect(hintPanels).toBeVisible();
		await hint.click();
		await expect(hint).toHaveAttribute('aria-expanded', 'false');
		await expect(hintPanels).toHaveCount(0);
		await hint.press('Enter');
		await expect(hintPanels).toBeVisible();
		await hint.press('Space');
		await expect(hintPanels).toHaveCount(0);

		await page.keyboard.press('Escape');
		await expect(panel).toHaveCount(0);
		await expect(trigger).toBeFocused();
		await trigger.click();
		await expect(hintPanels).toHaveCount(0);
		await expect(panel.locator('[data-ui="info-hint"]')).toHaveAttribute('aria-expanded', 'false');
		await page.keyboard.press('Escape');
	}
});
