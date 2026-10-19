import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { requestAgentJson } from '../../support/agent';
import { readAgentCreateAppResponse } from '../../../../packages/shared/src/agent/scope/http-codec';
import { readAgentGrantView } from '../../../../packages/shared/src/agent/governance/http-codec';

test('native configuration explains execution and target boundaries without the retired mode controls', async ({
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
	await page.goto('/connections');
	await page.getByRole('button', { name: 'Open Agent', exact: true }).click();
	const hub = page.locator('.agent-hub-window');
	await expect(hub.getByRole('heading', { name: 'Native threads', exact: true })).toBeVisible();
	await expect(
		hub.getByText('Uses the current session and actual App version, independently of plugin grants.', {
			exact: true,
		}),
	).toBeVisible();
	await hub.getByRole('textbox', { name: 'Thread title', exact: true }).fill('Configuration thread');
	await hub.getByRole('button', { name: 'Create thread', exact: true }).click();
	await expect(hub.getByRole('textbox', { name: 'Task input', exact: true })).toBeVisible();
	await expect(hub.getByRole('button', { name: 'Create a new Run', exact: true })).toBeDisabled();
	await expect(
		hub.getByText(
			'Selection only narrows scope; it grants no permission. Authorized non-SSH capabilities remain available without a target.',
			{
				exact: true,
			},
		),
	).toBeVisible();
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
