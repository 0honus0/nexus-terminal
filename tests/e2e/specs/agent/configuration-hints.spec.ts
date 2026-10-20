import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { openAgentConversations, requestAgentJson } from '../../support/agent';
import { readAgentCreateAppResponse } from '../../../../packages/shared/src/agent/scope/http-codec';
import { ensureTestSshConnection } from '../../support/ssh';
import { readAgentGrantView } from '../../../../packages/shared/src/agent/governance/http-codec';

test('native target selection preserves grants and uses the authenticated App without retired mode controls', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await setUiLanguage(context.request);
	const app = await requestAgentJson(
		context.request,
		{
			method: 'POST',
			path: '/apps',
			status: 201,
			data: { name: 'Configuration boundaries' },
		},
		readAgentCreateAppResponse,
	);
	const connectionId = await ensureTestSshConnection(context.request);
	await page.goto('/connections');
	await page.getByRole('button', { name: 'Open Agent', exact: true }).click();
	const hub = page.locator('.agent-hub-window');
	await hub.getByRole('button', { name: 'Choose an Agent app', exact: true }).click();
	await page
		.locator('[data-agent-hub-portal]')
		.getByRole('button')
		.filter({ has: page.getByText(app.id, { exact: true }) })
		.click();
	await openAgentConversations(page);
	await expect(hub.getByRole('heading', { name: 'Conversations', exact: true })).toBeVisible();
	await hub.getByRole('textbox', { name: 'Thread title', exact: true }).fill('Configuration thread');
	await hub.getByRole('button', { name: 'Create thread', exact: true }).click();
	await expect(hub.getByRole('textbox', { name: 'Task input', exact: true })).toBeVisible();
	await expect(hub.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
	await hub.getByRole('button', { name: 'Select SSH targets', exact: true }).click();
	const targets = page.locator('fieldset').filter({ has: page.locator('legend', { hasText: 'Select SSH targets' }) });
	const target = targets.locator('input[type="checkbox"][value="' + connectionId + '"]');
	await target.check();
	await expect(target).toBeChecked();
	await page.keyboard.press('Escape');
	await expect(hub.getByRole('textbox', { name: 'Task input', exact: true })).toBeVisible();
	await expect(hub.getByRole('button', { name: 'Execution mode', exact: true })).toHaveCount(0);
	await expect(hub.getByRole('button', { name: 'Approval mode', exact: true })).toHaveCount(0);
	const grants = await requestAgentJson(
		context.request,
		{
			method: 'GET',
			path: '/apps/' + app.id + '/grants',
		},
		readAgentGrantView,
	);
	expect(grants.grants).toEqual([]);
});
