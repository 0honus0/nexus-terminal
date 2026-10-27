import { expect, test } from '../../support/fixtures';
import { closeConnectedFileManager, reopenConnectedFileManager, E2E_SSH } from '../../support/ssh';
import {
	openFileManager,
	refreshFileManager,
	row,
	startZipCompression,
	visibleProgressCenter,
	visibleProgressTask,
} from './progress-display.helpers';

async function preflightProcesses(): Promise<{ started: number; exited: number }> {
	const response = await fetch(`${E2E_SSH.controlUrl}/archive/preflight-processes`);
	expect(response.ok).toBe(true);
	return response.json();
}

test('archive remains cancelled while remote command preparation is stalled', async ({ page, context }) => {
	test.setTimeout(75_000);
	await page.clock.install();
	await openFileManager(page, context);
	await fetch(`${E2E_SSH.controlUrl}/archive/preflight-hold?enabled=1`, { method: 'POST' });

	try {
		await startZipCompression(page, 'archive-source.txt');

		const popup = visibleProgressCenter(page);
		const task = visibleProgressTask(page, 'archive-source.zip');
		await expect(popup).toBeVisible({ timeout: 10_000 });
		await expect
			.poll(async () => {
				const processes = await preflightProcesses();
				return processes.started - processes.exited;
			})
			.toBeGreaterThan(0);
		await closeConnectedFileManager(page);
		await task.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(task).toHaveAttribute('data-task-status', 'cancelled', { timeout: 10_000 });
		await expect(popup).toBeHidden({ timeout: 4_000 });

		// A prolonged remote preflight must not be allowed to forget the user's cancellation
		// after the cancelled progress row has already auto-cleaned from the UI.
		await page.clock.fastForward(31_500);
		await fetch(`${E2E_SSH.controlUrl}/archive/preflight-hold?enabled=0`, { method: 'POST' });
		await expect
			.poll(async () => {
				const processes = await preflightProcesses();
				return processes.started - processes.exited;
			})
			.toBe(0);

		await reopenConnectedFileManager(page);
		await refreshFileManager(page);
		await expect(row(page, 'archive-source.zip')).toHaveCount(0);
	} finally {
		await fetch(`${E2E_SSH.controlUrl}/archive/preflight-hold?enabled=0`, { method: 'POST' });
	}
});
