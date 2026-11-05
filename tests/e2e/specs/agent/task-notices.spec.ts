import {
	cancelNativeTask,
	captureNativeCommand,
	openNativeTask,
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
	test.describe('Agent transient task notices at ' + width + 'px', () => {
		test.use({ viewport: { width, height: 844 }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
		test('minimizing is passive, a new approval can be decided once, and completion auto-hides without stealing focus', async ({
			page,
			request,
		}) => {
			await loginAsInitialAdmin(request);
			const connectionId = await ensureTestSshConnection(request);
			const prepared = await prepareNativeTask(request, page, ['shell.execute'], [connectionId]);
			await openNativeTask(prepared);
			const run = await startNativeTask(prepared, `E2E_NATIVE_PLUGIN_NOTICES connection=${connectionId}`, [
				connectionId,
			]);
			try {
				const first = await waitNativeApproval(prepared, run.id, 'shell_execute');
				const hub = page.getByRole('dialog', { name: 'Agent', exact: true });
				await expect(hub.getByRole('button', { name: 'Show or hide task panel', exact: true })).toHaveAttribute(
					'aria-expanded',
					'true',
				);
				const tasks = hub.getByRole('complementary', { name: 'Tasks', exact: true });
				await tasks.getByText('Execution details', { exact: true }).click();
				await expect(tasks.getByText('1. printf notice-first', { exact: true })).toBeVisible();
				await hub.getByRole('button', { name: 'Minimize Agent', exact: true }).click();
				const notice = page.getByRole('dialog', { name: 'Task update', exact: true });
				await expect(notice).toHaveCount(0);
				const launcher = page.getByRole('button', { name: 'Open Agent', exact: true });
				await launcher.focus();
				await expect(page.getByRole('img', { name: '1 pending approvals', exact: true })).toBeVisible();
				await resolveNativeApproval(prepared, first, 'approved');
				const second = await waitNativeApproval(prepared, run.id, 'shell_execute');
				expect(second.id).not.toBe(first.id);
				await expect(notice).toBeVisible();
				await expect(notice.getByText('Your approval is needed', { exact: true })).toBeVisible();
				await expect(notice.getByText('1. printf notice-second', { exact: true })).toBeVisible();
				await expect(launcher).toBeFocused();
				await expect(hub).toBeHidden();
				const bounds = await notice.boundingBox();
				expect(bounds).toBeTruthy();
				if (!bounds) throw new Error('Missing visible notice geometry');
				expect(bounds.x).toBeGreaterThanOrEqual(0);
				expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
				expect(bounds.y).toBeGreaterThanOrEqual(0);
				expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
				const receipt = await captureNativeCommand(prepared, 'agent.approvals.resolve', () =>
					notice.getByRole('button', { name: 'Approve and run', exact: true }).click(),
				);
				expect(receipt.result.method).toBe('agent.approvals.resolve');
				await expect.poll(async () => (await readNativeRun(prepared, run.id)).status).toBe('completed');
				await expect(notice.getByText('Task completed', { exact: true })).toBeVisible();
				await expect(notice.getByText('NOTICE_COMPLETED', { exact: true })).toBeVisible();
				await expect(page.getByRole('img', { name: '1 pending approvals', exact: true })).toHaveCount(0);
				await launcher.focus();
				await page.mouse.move(0, 0);
				await expect(notice).toHaveCount(0, { timeout: 12_000 });
				await expect(launcher).toBeFocused();
				await launcher.press('Enter');
				await expect(hub).toBeVisible();
				await expect(hub.getByText('NOTICE_COMPLETED', { exact: true })).toBeVisible();
				await hub.getByRole('button', { name: 'Minimize Agent', exact: true }).click();
				await expect(notice).toHaveCount(0);
			} finally {
				await cancelNativeTask(prepared, run.id);
			}
		});
	});
}
