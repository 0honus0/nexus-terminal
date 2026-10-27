import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '../../../support/fixtures';
import { loginAsInitialAdmin } from '../../../support/auth';
import {
	E2E_SSH,
	configureSshE2eSettings,
	connectTestSshFromConnectionsPage,
	openConnectedFileManager,
} from '../../../support/ssh';
import { rightClickRow, clickMenuItem } from '../progress-display.helpers';
import { readServerTransferSnapshot } from '../../../../../packages/shared/src/remote/transfers/server-codec';
import { target } from './fixtures';

for (const scenario of ['install-rsync', 'skip-rsync', 'install-scp', 'leave'] as const) {
	test(`send UI: ${scenario} waits for tool preparation before creating the background task`, async ({
		page,
		context,
	}) => {
		await loginAsInitialAdmin(context.request);
		await configureSshE2eSettings(context.request);
		const sourceId = await target(context.request, E2E_SSH.port);
		await target(context.request, E2E_SSH.transferTargetPort);
		const health = await (await fetch(`${E2E_SSH.controlUrl}/health`)).json();
		const root = String(health.rootDir);
		const filename = 'send-install-package.zip';
		const bytes = Buffer.alloc(512 * 1024, 0x61);
		await writeFile(path.join(root, filename), bytes);
		await connectTestSshFromConnectionsPage(page, sourceId);
		await openConnectedFileManager(page);
		expect(
			(
				await fetch(
					`${E2E_SSH.controlUrl}/remote-tools?missing=${scenario === 'install-scp' ? 'rsync,scp' : 'rsync'}`,
					{ method: 'POST' },
				)
			).ok,
		).toBe(true);
		let sent: ReturnType<typeof readServerTransferSnapshot> | undefined;
		await page.route('**/api/v1/transfers/send', async (route) => {
			const response = await route.fetch();
			expect(response.status()).toBe(202);
			sent = readServerTransferSnapshot(await response.json());
			await route.fulfill({ response });
		});
		try {
			await rightClickRow(page, filename);
			await clickMenuItem(page, 'Send to servers');
			const modal = page.getByRole('dialog', { name: 'Send Files', exact: true });
			await expect(modal).toBeVisible();
			const targetRow = modal.locator('li').filter({ hasText: `Transfer peer ${E2E_SSH.transferTargetPort}` });
			await expect(targetRow).toHaveCount(1);
			await targetRow.click();
			await modal.getByLabel('Target Path', { exact: true }).click();
			const picker = page.getByRole('dialog', { name: 'Select destination directory', exact: true });
			await expect(picker).toBeVisible();
			await picker.getByRole('button', { name: 'folder-seed', exact: true }).click();
			await picker.getByRole('button', { name: 'Use this directory', exact: true }).click();
			await modal.getByRole('button', { name: 'Send', exact: true }).click();
			const trust = page.getByRole('dialog', { name: 'Please confirm', exact: true });
			await expect(trust).toBeVisible();
			await trust.getByRole('button', { name: 'Confirm', exact: true }).click();
			const install = page.getByRole('dialog', { name: 'Install required tools', exact: true });
			await expect(install).toBeVisible();
			await expect(install).toContainText('rsync');
			expect(sent).toBeUndefined();
			if (scenario === 'leave') {
				await page.goto('/connections');
				await expect(install).toHaveCount(0);
				expect(sent).toBeUndefined();
				expect(existsSync(path.join(root, 'folder-seed', filename))).toBe(false);
			} else {
				await install
					.getByRole('button', {
						name: scenario === 'install-rsync' ? 'Install and continue' : 'Skip installation',
						exact: true,
					})
					.click();
				if (scenario === 'install-scp') {
					await expect(install).toContainText('scp');
					expect(sent).toBeUndefined();
					await install.getByRole('button', { name: 'Install and continue', exact: true }).click();
				}
				await expect(install).toBeHidden();
				await expect(modal).toBeHidden();
				await expect.poll(() => sent?.taskId).toBeTruthy();
				const task = sent;
				if (!task) {
					throw new Error('Missing send receipt after tool preparation');
				}
				await expect
					.poll(
						async () => {
							const response = await context.request.get(`/api/v1/transfers/status/${task.taskId}`);
							expect(response.status()).toBe(200);
							const current = readServerTransferSnapshot(await response.json());
							expect(['failed', 'unknown', 'partially-completed']).not.toContain(current.status);
							if (current.status === 'completed')
								expect(current.subTasks[0]?.transferMethodUsed).toBe(
									scenario === 'install-rsync' ? 'rsync' : 'scp',
								);
							return current.status;
						},
						{ timeout: 30000 },
					)
					.toBe('completed');
				expect(
					createHash('sha256')
						.update(await readFile(path.join(root, 'folder-seed', filename)))
						.digest('hex'),
				).toBe(createHash('sha256').update(bytes).digest('hex'));
			}
			const tools = await (await fetch(`${E2E_SSH.controlUrl}/remote-tools`)).json();
			expect(tools.installs).toBe(scenario === 'install-rsync' || scenario === 'install-scp' ? 1 : 0);
			expect(await readFile(path.join(root, filename))).toEqual(bytes);
		} finally {
			expect((await fetch(`${E2E_SSH.controlUrl}/remote-tools`, { method: 'POST' })).ok).toBe(true);
		}
	});
}
