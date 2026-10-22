import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { enableTestAgentExecution, openAgentConversations, requestAgentJson } from '../../support/agent';
import { readAgentCreateAppResponse } from '../../../../packages/shared/src/agent/scope/http-codec';
import { createTestSshConnection, ensureTestSshConnection } from '../../support/ssh';
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
	const secondConnectionId = await createTestSshConnection(context.request, 'Configuration boundaries secondary');
	await enableTestAgentExecution(context.request);
	await page.goto('/connections');
	await page.getByRole('button', { name: 'Open Agent', exact: true }).click();
	const hub = page.locator('.agent-hub-window');
	await hub.getByRole('button', { name: 'Choose an Agent app', exact: true }).click();
	await page
		.locator('[data-agent-hub-portal]')
		.getByRole('button')
		.filter({ has: page.getByText(app.name, { exact: true }) })
		.click();
	await openAgentConversations(page);
	const threads = hub.locator('#agent-thread-sidebar');
	await expect(threads.getByText('Conversations', { exact: true })).toBeVisible();
	await threads.getByRole('button', { name: 'New', exact: true }).click();
	await expect(hub.getByRole('textbox', { name: 'Task input', exact: true })).toBeVisible();
	const conversation = hub.locator('.agent-conversation-scroller');
	await expect.poll(() => conversation.evaluate((element) => element.scrollHeight - element.clientHeight)).toBe(0);
	await expect(hub.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
	await hub.getByRole('button', { name: 'Select SSH targets', exact: true }).click();
	const targets = page.locator('fieldset').filter({ has: page.locator('legend', { hasText: 'Select SSH targets' }) });
	const target = targets.locator('input[type="checkbox"][value="' + connectionId + '"]');
	const secondTarget = targets.locator('input[type="checkbox"][value="' + secondConnectionId + '"]');
	const enableAll = targets.getByRole('button', { name: 'Enable all', exact: true });
	const disableAll = targets.getByRole('button', { name: 'Disable all', exact: true });
	await expect(disableAll).toBeDisabled();
	await enableAll.click();
	await expect(target).toBeChecked();
	await expect(secondTarget).toBeChecked();
	await expect(enableAll).toBeDisabled();
	await disableAll.click();
	await expect(target).not.toBeChecked();
	await expect(secondTarget).not.toBeChecked();
	await expect(disableAll).toBeDisabled();
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
