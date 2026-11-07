import { agentHost } from '../../fixtures/agent/workbench';
import {
	cancelNativeTask,
	openNativeTask,
	openNativeTaskPanel,
	prepareNativeTask,
	readNativeRun,
	resolveNativeApproval,
	startNativeTask,
	waitNativeApproval,
} from '../../fixtures/agent/native-task';
import { expect, test } from '../../support/fixtures';
import { ensureTestSshConnection } from '../../support/ssh';
import { loginAsInitialAdmin } from '../../support/auth';

for (const width of [1280, 390, 320]) {
	test.describe('Agent resource lifecycle at ' + width + 'px', () => {
		test.use({ viewport: { width, height: 844 }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
		for (const action of ['connection', 'interface']) {
			test(
				action + ' close confirms active tasks; cancel and minimize preserve the same connection',
				async ({ page, request }, testInfo) => {
					await loginAsInitialAdmin(request);
					const connectionId = await ensureTestSshConnection(request);
					const task = await prepareNativeTask(request, page, ['shell.execute'], [connectionId]);
					const hub = await openNativeTask(task);
					const run = await startNativeTask(task, `E2E_NATIVE_PLUGIN_NOTICES connection=${connectionId}`, [
						connectionId,
					]);
					try {
						const first = await waitNativeApproval(task, run.id, 'shell_execute');
						await resolveNativeApproval(task, first, 'approved');
						const second = await waitNativeApproval(task, run.id, 'shell_execute');
						expect(second.id).not.toBe(first.id);
						await openNativeTaskPanel(page);
						const tasks = hub.getByRole('complementary', { name: 'Tasks', exact: true });
						await tasks.getByText('Execution details', { exact: true }).click();
						const resource = tasks.locator('[data-agent-resources] article');
						await expect(resource).toHaveCount(1);
						await expect(resource).toHaveAttribute('data-resource-state', 'idle');
						await expect(resource.getByText('SSH 1', { exact: true })).toBeVisible();
						const resourceId = await resource.getAttribute('data-resource-id');
						expect(resourceId).toBeTruthy();
						await agentHost(page).getByRole('button', { name: 'Minimize Agent', exact: true }).click();
						await expect(agentHost(page)).toBeHidden();
						expect((await readNativeRun(task, run.id)).status).toBe('running');
						await page.getByRole('button', { name: 'Open Agent', exact: true }).click();
						await expect(resource).toHaveAttribute('data-resource-id', resourceId ?? '');
						const close =
							action === 'connection'
								? resource.getByRole('button', { name: 'Close connections', exact: true })
								: agentHost(page).getByRole('button', { name: 'Close Agent', exact: true });
						await close.click();
						const confirmation = page.getByRole('dialog', {
							name: 'Stop tasks and close connections?',
							exact: true,
						});
						await expect(confirmation).toBeVisible();
						await testInfo.attach('resource-close-confirmation-' + width, {
							body: await page.screenshot(),
							contentType: 'image/png',
						});
						await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
						await expect(confirmation).toBeHidden();
						await expect(resource).toHaveAttribute('data-resource-id', resourceId ?? '');
						expect((await readNativeRun(task, run.id)).status).toBe('running');
						await close.click();
						await confirmation.getByRole('button', { name: 'Stop and close', exact: true }).click();
						await expect.poll(async () => (await readNativeRun(task, run.id)).status).toBe('cancelled');
						if (action === 'interface') {
							await expect(agentHost(page)).toBeHidden();
							await page.getByRole('button', { name: 'Open Agent', exact: true }).click();
						}
						await expect(tasks.locator('[data-agent-resources]')).toHaveCount(0);
					} finally {
						await cancelNativeTask(task, run.id);
					}
				},
			);
		}
	});
}
