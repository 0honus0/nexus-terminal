import { readWorkspaceMessage } from '../../../../packages/shared/src/remote/workspace/workspace-codec';
import { readWorkspaceCopyMoveEvent } from '../../../../packages/shared/src/remote/transfers/task-codec';
import { expect, test } from '../../support/fixtures';
import { closeConnectedFileManager, reopenConnectedFileManager, E2E_SSH } from '../../support/ssh';
import {
	clickMenuItem,
	closeProgressDisplay,
	goIntoFolder,
	hideVisibleProgressCenter,
	hiddenTask,
	openCurrentDirectoryContextMenu,
	openFileManager,
	openProgressDisplay,
	refreshFileManager,
	rightClickRow,
	row,
} from './progress-display.helpers';

async function writeState(): Promise<{ held: number; pending: number; requests: number }> {
	const response = await fetch(`${E2E_SSH.controlUrl}/sftp/write-hold`);
	expect(response.ok).toBe(true);
	return response.json();
}

test('copy remains cancelled after a long remote write stall', async ({ page, context }) => {
	test.setTimeout(65_000);
	const terminalEvents = new Map<string, string>();
	page.on('websocket', (socket) => {
		if (!new URL(socket.url()).pathname.endsWith('/ws/workspace')) return;
		socket.on('framereceived', ({ payload }) => {
			if (typeof payload !== 'string') return;
			const message = readWorkspaceMessage(JSON.parse(payload));
			if (message.type !== 'transfer.copyMove') return;
			const event = readWorkspaceCopyMoveEvent(message.payload);
			if (event.type === 'completed' || event.type === 'cancelled' || event.type === 'failed') {
				terminalEvents.set(event.requestId, event.type);
			}
		});
	});
	await page.clock.install();
	await openFileManager(page, context);
	const sourceName = 'cancel-marker-dir';
	await fetch(`${E2E_SSH.controlUrl}/fixture-directory?name=${encodeURIComponent(sourceName)}&size=${32 * 1024}`, {
		method: 'POST',
	});
	await refreshFileManager(page);
	await expect(row(page, sourceName)).toBeVisible();
	await fetch(`${E2E_SSH.controlUrl}/sftp/write-hold?blocked=1`, { method: 'POST' });

	try {
		await rightClickRow(page, sourceName);
		await clickMenuItem(page, 'Copy');
		await goIntoFolder(page, 'folder-seed');
		await openCurrentDirectoryContextMenu(page);
		await clickMenuItem(page, 'Paste');

		await expect(page.locator('.transfer-progress-window')).toBeVisible({ timeout: 10_000 });
		await closeConnectedFileManager(page);
		await hideVisibleProgressCenter(page);
		const modal = await openProgressDisplay(page);
		const task = hiddenTask(modal, sourceName);
		await expect(task).toBeVisible();
		const taskId = await task.getAttribute('data-task-id');
		expect(taskId).toBeTruthy();
		await expect.poll(async () => (await writeState()).held).toBeGreaterThan(0);
		await task.getByRole('button', { name: 'Cancel', exact: true }).click();
		await closeProgressDisplay(modal);

		// Old code forgot cancellation after 30s. Keep the first write blocked beyond that
		// boundary, then make all later writes immediate so a resurrected copy is observable.
		await page.clock.fastForward(32_000);
		await expect.poll(async () => (await writeState()).held).toBeGreaterThan(0);
		await fetch(`${E2E_SSH.controlUrl}/sftp/write-hold?blocked=0`, { method: 'POST' });
		await expect.poll(async () => (await writeState()).pending).toBe(0);
		await expect.poll(() => terminalEvents.get(taskId!)).toMatch(/^(failed|cancelled)$/);

		await reopenConnectedFileManager(page);
		await refreshFileManager(page);
		const partialDirectory = row(page, sourceName);
		if ((await partialDirectory.count()) > 0) {
			await partialDirectory.click();
			await expect(row(page, '02-second.bin')).toHaveCount(0);
		}
	} finally {
		await fetch(`${E2E_SSH.controlUrl}/sftp/write-hold?blocked=0`, { method: 'POST' });
	}
});
