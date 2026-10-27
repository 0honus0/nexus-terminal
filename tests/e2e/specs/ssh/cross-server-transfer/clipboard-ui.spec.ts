import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '../../../support/fixtures';
import { loginAsInitialAdmin } from '../../../support/auth';
import {
	E2E_SSH,
	configureSshE2eSettings,
	connectTestSshFromConnectionsPage,
	openConnectedFileManager,
	closeConnectedFileManager,
	resetTestSshFilesystem,
} from '../../../support/ssh';
import {
	rightClickRow,
	clickMenuItem,
	goIntoFolder,
	openCurrentDirectoryContextMenu,
	visibleProgressTask,
} from '../progress-display.helpers';
import { readWorkspaceMessage } from '../../../../../packages/shared/src/remote/workspace/workspace-codec';
import { readWorkspaceCopyMoveEvent } from '../../../../../packages/shared/src/remote/transfers/task-codec';
import { WorkspaceCopyMoveEvent } from '../../../../../packages/shared/src/remote/transfers/workspace';
import { target } from './fixtures';

for (const scenario of ['direct', 'relay', 'install-rsync', 'skip-rsync', 'skip-all'] as const) {
	const blocked = scenario === 'relay' || scenario === 'skip-all';
	test(`clipboard UI: ${scenario} cross-server paste displays live byte progress and completes the exact file`, async ({
		page,
		context,
	}, testInfo) => {
		const request = context.request;
		test.setTimeout(90_000);
		await loginAsInitialAdmin(request);
		await configureSshE2eSettings(request);
		await resetTestSshFilesystem();
		const sourceId = await target(request, E2E_SSH.port);
		const destinationId = await target(request, E2E_SSH.transferTargetPort);
		const health = await (await fetch(`${E2E_SSH.controlUrl}/health`)).json();
		const root = String(health.rootDir);
		const filename = 'clipboard-progress-package.zip';
		const bytes = Buffer.alloc(8 * 1024 * 1024, 0x5a);
		await writeFile(path.join(root, filename), bytes);
		const taskEvents: WorkspaceCopyMoveEvent[] = [];
		const protocolErrors: string[] = [];
		page.on('websocket', (socket) => {
			if (new URL(socket.url()).pathname !== '/ws/workspace') return;
			socket.on('framereceived', ({ payload }) => {
				if (typeof payload !== 'string') return;
				try {
					const message = readWorkspaceMessage(JSON.parse(payload));
					if (message.type === 'transfer.copyMove' && !('requestId' in message)) {
						taskEvents.push(readWorkspaceCopyMoveEvent(message.payload));
					}
				} catch (cause) {
					protocolErrors.push(cause instanceof Error ? cause.message : String(cause));
				}
			});
		});
		try {
			expect(
				(
					await fetch(`${E2E_SSH.controlUrl}/transfer-peer?blocked=${blocked ? 1 : 0}&bandwidth=1024`, {
						method: 'POST',
					})
				).ok,
			).toBe(true);
			expect(
				(
					await fetch(
						`${E2E_SSH.controlUrl}/sftp/read-network?ms=${blocked ? 40 : 0}&bytesPerSecond=${blocked ? 1024 * 1024 : 0}`,
						{ method: 'POST' },
					)
				).ok,
			).toBe(true);
			const missing =
				scenario === 'skip-all' ? 'rsync,scp' : scenario === 'direct' || scenario === 'relay' ? '' : 'rsync';
			expect((await fetch(`${E2E_SSH.controlUrl}/remote-tools?missing=${missing}`, { method: 'POST' })).ok).toBe(
				true,
			);
			// Both sessions are connected before copying: leaving Workspace deliberately clears its clipboard.
			await connectTestSshFromConnectionsPage(page, sourceId);
			await page.getByRole('button', { name: 'New Connection Tab', exact: true }).click();
			await page.locator(`.workspace-connection-list [data-connection-id="${destinationId}"]`).click();
			await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('data-session-state', 'connected', {
				timeout: 35_000,
			});
			await expect(page.locator('.terminal-tab-shell').getByRole('tab')).toHaveCount(2);
			const sourceTab = page.getByRole('tab').filter({ hasText: `Transfer peer ${E2E_SSH.port}` });
			await sourceTab.click();
			await expect(sourceTab).toHaveAttribute('aria-selected', 'true');
			await openConnectedFileManager(page);
			await rightClickRow(page, filename);
			await clickMenuItem(page, 'Copy');
			await closeConnectedFileManager(page);
			const destinationTab = page
				.getByRole('tab')
				.filter({ hasText: `Transfer peer ${E2E_SSH.transferTargetPort}` });
			await destinationTab.click();
			await expect(destinationTab).toHaveAttribute('aria-selected', 'true');
			await openConnectedFileManager(page);
			await goIntoFolder(page, 'folder-seed');
			const monitor = await page.evaluateHandle((name) => {
				const samples: Array<{ id: string; status: string; percent: number; text: string }> = [];

				const collect = () => {
					for (const row of document.querySelectorAll('.transfer-progress-window [data-task-id]')) {
						if (!row.textContent?.includes(name)) continue;
						const bar = row.querySelector('[role="progressbar"]');
						if (!bar) continue;
						const sample = {
							id: row.getAttribute('data-task-id') ?? '',
							status: row.getAttribute('data-task-status') ?? '',
							percent: Number(bar.getAttribute('aria-valuenow')),
							text: row.textContent ?? '',
						};
						if (JSON.stringify(sample) !== JSON.stringify(samples.at(-1))) samples.push(sample);
					}
				};

				const observer = new MutationObserver(collect);
				observer.observe(document.body, {
					subtree: true,
					childList: true,
					attributes: true,
					characterData: true,
				});
				return {
					samples,

					stop: () => observer.disconnect(),
				};
			}, filename);
			try {
				await openCurrentDirectoryContextMenu(page);
				await clickMenuItem(page, 'Paste');
				const confirmation = page.getByRole('dialog', { name: 'Please confirm', exact: true });
				await expect(confirmation).toBeVisible();
				await confirmation.getByRole('button', { name: 'Confirm', exact: true }).click();
				if (scenario === 'install-rsync' || scenario === 'skip-rsync' || scenario === 'skip-all') {
					const install = page.getByRole('dialog', { name: 'Install required tools', exact: true });
					await expect(install).toBeVisible();
					await expect(install).toContainText('rsync');
					expect(taskEvents).toEqual([]);
					await install
						.getByRole('button', {
							name: scenario === 'install-rsync' ? 'Install and continue' : 'Skip installation',
							exact: true,
						})
						.click();
					if (scenario === 'skip-all') {
						await expect(install).toContainText('scp');
						await install.getByRole('button', { name: 'Skip installation', exact: true }).click();
					}
					await expect(install).toBeHidden();
				}
				const card = visibleProgressTask(page, filename);
				await expect(card).toBeVisible();
				await expect
					.poll(() => card.getByRole('progressbar').getAttribute('aria-valuenow'), { timeout: 30_000 })
					.toMatch(/^(?:[1-9]|[1-9][0-9])$/);
				const id = await card.getAttribute('data-task-id');
				expect(id).toBeTruthy();
				await expect
					.poll(() => taskEvents.find((event) => event.requestId === id && event.type === 'completed'), {
						timeout: 45_000,
					})
					.toMatchObject({
						crossSession: true,
						mode: 'copy',
						sourcePaths: [`/${filename}`],
						destinationPath: '/folder-seed',
					});
				// Completed client tasks retire automatically; do not require a transient 100% frame to paint.
				await expect(card).toHaveCount(0);
				const samples = await monitor.evaluate((state) => state.samples);
				const live = samples.filter((sample) => sample.id === id && sample.percent > 0 && sample.percent < 100);
				expect(new Set(live.map((sample) => sample.percent)).size).toBeGreaterThan(1);
				expect(live.some((sample) => /8(?:\.0)?\s*(?:MiB|MB)/.test(sample.text))).toBe(true);
				let previousPercent = 0;
				for (const sample of live) {
					expect(sample.percent).toBeGreaterThanOrEqual(previousPercent);
					previousPercent = sample.percent;
				}
				expect(protocolErrors).toEqual([]);
				expect(taskEvents.filter((event) => event.requestId === id && event.type === 'failed')).toEqual([]);
				expect(
					taskEvents.some(
						(event) =>
							event.requestId === id &&
							event.type === 'progress' &&
							event.totalKnown &&
							event.totalBytes === bytes.length &&
							event.transferredBytes > 0 &&
							event.transferredBytes < bytes.length,
					),
				).toBe(true);
				const actual = await readFile(path.join(root, 'folder-seed', filename));

				const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');

				expect(digest(actual)).toBe(digest(bytes));
				expect(digest(await readFile(path.join(root, filename)))).toBe(digest(bytes));
				const peer = await (await fetch(`${E2E_SSH.controlUrl}/transfer-peer`)).json();
				const reads = await (await fetch(`${E2E_SSH.controlUrl}/sftp/read-network`)).json();
				const tools = await (await fetch(`${E2E_SSH.controlUrl}/remote-tools`)).json();
				expect(tools.installs).toBe(scenario === 'install-rsync' ? 1 : 0);
				expect(peer.nativeTransfersStarted).toBe(blocked ? 0 : 1);
				expect(reads.sftpReadResponseBytes).toBe(blocked ? bytes.length : 0);
				await testInfo.attach('clipboard-ui-progress', {
					body: JSON.stringify({ blocked, samples, taskEvents, peer, reads }),
					contentType: 'application/json',
				});
			} finally {
				await monitor.evaluate((state) => state.stop());
				await monitor.dispose();
			}
		} finally {
			await fetch(`${E2E_SSH.controlUrl}/transfer-peer`, { method: 'POST' });
			await fetch(`${E2E_SSH.controlUrl}/sftp/read-network?ms=0`, { method: 'POST' });
		}
	});
}
