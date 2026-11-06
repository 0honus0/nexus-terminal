import { devices } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, setUiLanguage } from '../../support/auth';
import { requestAgentJson } from '../../support/agent-request';
import {
	createTestAgentApp,
	enableTestAgentExecution,
	openAgentConversations,
	openAgentHub,
} from '../../support/agent';
import { createTestSshConnection, ensureTestSshConnection } from '../../support/ssh';
import { readAgentGrantView } from '../../../../packages/shared/src/agent/governance/http-codec';

for (const profile of ['Desktop Chrome', 'Pixel 7']) {
	test.describe(profile + ' target width', () => {
		test.use({ userAgent: devices[profile].userAgent, viewport: { width: 1440, height: 1000 } });
		test('native target selection preserves grants and uses the authenticated App without retired mode controls', async ({
			page,
			context,
		}) => {
			await loginAsInitialAdmin(context.request);
			await setUiLanguage(context.request);
			const app = await createTestAgentApp(context.request, 'Configuration boundaries');
			const connectionId = await ensureTestSshConnection(context.request);
			const secondConnectionId = await createTestSshConnection(
				context.request,
				'Configuration boundaries secondary',
			);
			await enableTestAgentExecution(context.request);
			await page.goto('/connections');
			await openAgentHub(page);
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
			await expect
				.poll(() => conversation.evaluate((element) => element.scrollHeight - element.clientHeight))
				.toBe(0);
			await expect(hub.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
			await hub.getByRole('button', { name: 'Select SSH targets', exact: true }).click();
			const targets = page
				.locator('fieldset')
				.filter({ has: page.locator('legend', { hasText: 'Select SSH targets' }) });
			const target = targets.getByRole('checkbox').and(page.locator('#agent-target-' + connectionId));
			const secondTarget = targets.getByRole('checkbox').and(page.locator('#agent-target-' + secondConnectionId));
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
			await expect(hub.getByRole('button', { name: 'Approval mode', exact: true })).toBeVisible();
			await expect(hub.getByRole('button', { name: 'Approval mode', exact: true })).toContainText(
				'Ask when needed',
			);
			const trigger = hub.getByRole('button', { name: 'Select SSH targets', exact: true });
			await expect(trigger).toContainText('Select SSH targets');
			await expect(trigger).toContainText('· 1');
			for (const width of [390, 320]) {
				await page.setViewportSize({ width, height: 1000 });
				await expect(trigger).toHaveText('');
				await expect(trigger.locator('.fa-server')).toBeVisible();
				await expect(trigger.locator('.fa-chevron-down')).toHaveCount(0);
				await expect.poll(() => trigger.evaluate((element) => element.getBoundingClientRect().height)).toBe(44);
				const controlsFit = await hub.locator('.agent-composer-toolbar').evaluate((toolbar) => {
					const bounds = toolbar.getBoundingClientRect();
					const buttons = Array.from(toolbar.querySelectorAll('button')).map((button) =>
						button.getBoundingClientRect(),
					);
					return buttons.every(
						(button, index) =>
							button.left >= bounds.left &&
							button.right <= bounds.right &&
							buttons.slice(index + 1).every((next) => button.right <= next.left),
					);
				});
				expect(controlsFit).toBe(true);
				await trigger.click();
				await expect(target).toBeChecked();
				await expect(secondTarget).not.toBeChecked();
				await page.keyboard.press('Escape');
				await expect(hub.getByRole('textbox', { name: 'Task input', exact: true })).toBeVisible();
			}
			await page.setViewportSize({ width: 1440, height: 1000 });
			await expect(trigger).toContainText('Select SSH targets');
			await expect(trigger).toContainText('· 1');
			await trigger.click();
			await expect(target).toBeChecked();
			await expect(secondTarget).not.toBeChecked();
			await page.keyboard.press('Escape');
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
	});
}
