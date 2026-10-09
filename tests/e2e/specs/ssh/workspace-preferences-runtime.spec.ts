import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
	configureSshE2eSettings,
	connectTestSshFromConnectionsPage,
	ensureTestSshConnection,
	fileManagerRow,
	openConnectedFileManager,
	resetTestSshFilesystem,
} from '../../support/ssh';
import { step } from '../../support/steps';
import { selectUiOption } from '../../support/ui-select';

const QUICK_COMMAND_NAME = 'E2E Command Input Sync';
const QUICK_COMMAND_MARKER = 'COMMAND_INPUT_SYNC_E2E';
const COMMAND_HISTORY_SYNC_MARKER = 'COMMAND_HISTORY_SYNC_E2E';

async function recreateQuickCommand(request: APIRequestContext): Promise<number> {
	const list = await request.get('/api/v1/quick-commands');
	expect(list.ok()).toBeTruthy();
	const commands = (await list.json()) as Array<{ id: number; name?: string }>;
	for (const command of commands.filter((item) => item.name === QUICK_COMMAND_NAME)) {
		expect((await request.delete(`/api/v1/quick-commands/${command.id}`)).ok()).toBeTruthy();
	}

	const create = await request.post('/api/v1/quick-commands', {
		data: {
			name: QUICK_COMMAND_NAME,
			command: `printf '${QUICK_COMMAND_MARKER}\\n'`,
			tagIds: [],
			variables: {},
		},
	});
	expect(create.status()).toBe(201);
	return ((await create.json()) as { command: { id: number } }).command.id;
}

test('command input sync setting drives quick-command search and keyboard execution in a live SSH session', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await resetTestSshFilesystem();

	const originalResponse = await context.request.get('/api/v1/settings');
	expect(originalResponse.ok()).toBeTruthy();
	const original = (await originalResponse.json()) as {
		commandInputSyncTarget?: string;
		quickCommandsCollapsibleSearch?: boolean;
		showQuickCommandTags?: boolean;
	};

	expect(
		(
			await context.request.put('/api/v1/settings', {
				data: {
					commandInputSyncTarget: 'none',
					quickCommandsCollapsibleSearch: false,
					showQuickCommandTags: false,
				},
			})
		).ok(),
	).toBeTruthy();

	const commandId = await recreateQuickCommand(context.request);
	const connectionId = await ensureTestSshConnection(context.request);

	try {
		await step('enable Quick Commands sync through Workspace settings and persist it', async () => {
			await page.goto('/settings');
			const commandsGroup = page
				.locator('form')
				.filter({ has: page.getByRole('heading', { name: 'Terminal & commands', exact: true }) });
			const syncTarget = commandsGroup.locator('#commandInputSyncTarget');
			await expect(syncTarget).toBeVisible();
			await selectUiOption(syncTarget, 'quickCommands');

			const responsePromise = page.waitForResponse(
				(response) => response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT',
			);
			await commandsGroup.getByRole('button', { name: 'Save group', exact: true }).click();
			expect((await responsePromise).ok()).toBeTruthy();

			const persisted = await context.request.get('/api/v1/settings');
			expect(persisted.ok()).toBeTruthy();
			expect(((await persisted.json()) as { commandInputSyncTarget?: string }).commandInputSyncTarget).toBe(
				'quickCommands',
			);
		});

		await step(
			'typing in the command bar filters Quick Commands and Enter executes the keyboard selection',
			async () => {
				await connectTestSshFromConnectionsPage(page, connectionId);
				const commandInput = page.locator('.command-bar-command-input:visible');
				const quickView = page.locator('.quick-commands-root:visible').first();
				const quickSearch = quickView.getByPlaceholder('Search name or command...', { exact: true });
				const row = quickView.locator(`[data-command-id="${commandId}"]`);
				const terminalRows = page.locator('.terminal-inner-container .xterm-rows');

				await expect(row).toBeVisible({ timeout: 20_000 });
				await commandInput.fill(QUICK_COMMAND_MARKER);
				await expect(quickSearch).toHaveValue(QUICK_COMMAND_MARKER);
				await expect(row).toBeVisible();

				await commandInput.press('ArrowDown');
				await expect(row).toHaveClass(/bg-primary\/20/);
				await commandInput.press('Enter');

				await expect
					.poll(async () => terminalRows.innerText(), { timeout: 15_000 })
					.toContain(QUICK_COMMAND_MARKER);
				await expect(commandInput).toHaveValue('');
				await expect(quickSearch).toHaveValue('');
			},
		);
	} finally {
		const restore = await context.request.put('/api/v1/settings', {
			data: {
				commandInputSyncTarget: original.commandInputSyncTarget ?? 'none',
				quickCommandsCollapsibleSearch: original.quickCommandsCollapsibleSearch ?? false,
				showQuickCommandTags: original.showQuickCommandTags ?? true,
			},
		});
		expect(restore.ok()).toBeTruthy();
		await context.request.delete(`/api/v1/quick-commands/${commandId}`);
	}
});

test('command input sync filters command history and executes the keyboard selection in a live SSH session', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await resetTestSshFilesystem();

	const originalResponse = await context.request.get('/api/v1/settings');
	expect(originalResponse.ok()).toBeTruthy();
	const original = (await originalResponse.json()) as { commandInputSyncTarget?: string };
	const historyCommand = `printf '${COMMAND_HISTORY_SYNC_MARKER}\\n'`;

	const existingHistory = await context.request.get('/api/v1/command-history');
	expect(existingHistory.ok()).toBeTruthy();
	for (const entry of (await existingHistory.json()) as Array<{ id: number; command: string }>) {
		if (entry.command !== historyCommand) continue;
		expect((await context.request.delete(`/api/v1/command-history/${entry.id}`)).ok()).toBeTruthy();
	}

	const createHistory = await context.request.post('/api/v1/command-history', {
		data: { command: historyCommand },
	});
	expect(createHistory.status()).toBe(201);
	const historyId = ((await createHistory.json()) as { id: number }).id;

	expect(
		(
			await context.request.put('/api/v1/settings', {
				data: { commandInputSyncTarget: 'commandHistory' },
			})
		).ok(),
	).toBeTruthy();

	const connectionId = await ensureTestSshConnection(context.request);

	try {
		await connectTestSshFromConnectionsPage(page, connectionId);
		const commandInput = page.locator('.command-bar-command-input:visible');
		const historyView = page.locator('.command-history-root:visible').first();
		const historySearch = historyView.locator('.command-history-search');
		const historyRow = historyView.locator(`[data-history-id="${historyId}"]`);
		const terminalRows = page.locator('.terminal-inner-container .xterm-rows');

		await expect(historyRow).toBeVisible({ timeout: 20_000 });
		await commandInput.fill(COMMAND_HISTORY_SYNC_MARKER);
		await expect(historySearch).toHaveValue(COMMAND_HISTORY_SYNC_MARKER);
		await expect(historyRow).toBeVisible();

		await commandInput.press('ArrowDown');
		await expect(historyRow).toHaveClass(/bg-primary\/20/);
		await commandInput.press('Enter');

		await expect
			.poll(async () => terminalRows.innerText(), { timeout: 15_000 })
			.toContain(COMMAND_HISTORY_SYNC_MARKER);
		await expect(commandInput).toHaveValue('');
		await expect(historySearch).toHaveValue('');
	} finally {
		const restore = await context.request.put('/api/v1/settings', {
			data: { commandInputSyncTarget: original.commandInputSyncTarget ?? 'none' },
		});
		expect(restore.ok()).toBeTruthy();

		const history = await context.request.get('/api/v1/command-history');
		expect(history.ok()).toBeTruthy();
		for (const entry of (await history.json()) as Array<{ id: number; command: string }>) {
			if (entry.command !== historyCommand) continue;
			const remove = await context.request.delete(`/api/v1/command-history/${entry.id}`);
			expect([200, 404]).toContain(remove.status());
		}
	}
});

test('file-manager delete confirmation setting can disable the prompt for real SFTP deletion', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await resetTestSshFilesystem();

	const originalResponse = await context.request.get('/api/v1/settings');
	expect(originalResponse.ok()).toBeTruthy();
	const original = (await originalResponse.json()) as { fileManagerShowDeleteConfirmation?: boolean };
	const connectionId = await ensureTestSshConnection(context.request);

	try {
		await step('disable delete confirmation through Workspace settings and persist it', async () => {
			await page.goto('/settings');
			const filesGroup = page
				.locator('form')
				.filter({ has: page.getByRole('heading', { name: 'Files & editor', exact: true }) });
			const confirmation = filesGroup.getByRole('checkbox', {
				name: 'Confirm before deleting files or folders',
				exact: true,
			});
			await expect(confirmation).toBeChecked();
			await confirmation.uncheck();

			const responsePromise = page.waitForResponse(
				(response) => response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT',
			);
			await filesGroup.getByRole('button', { name: 'Save group', exact: true }).click();
			expect((await responsePromise).ok()).toBeTruthy();

			const persisted = await context.request.get('/api/v1/settings');
			expect(persisted.ok()).toBeTruthy();
			expect(
				((await persisted.json()) as { fileManagerShowDeleteConfirmation?: boolean })
					.fileManagerShowDeleteConfirmation,
			).toBe(false);
		});

		await step('deleting a real file skips the confirmation dialog and removes it over SFTP', async () => {
			await connectTestSshFromConnectionsPage(page, connectionId);
			await openConnectedFileManager(page);
			const target = fileManagerRow(page, 'seed.txt');
			await expect(target).toBeVisible();
			await target.click({ button: 'right' });
			const menu = page.getByRole('menu').filter({ visible: true }).first();
			await expect(menu).toBeVisible();
			await menu.getByText('Delete', { exact: true }).click();

			await expect(page.getByRole('dialog', { name: 'Please confirm', exact: true })).toHaveCount(0);
			await expect(target).toHaveCount(0, { timeout: 20_000 });
		});
	} finally {
		const restore = await context.request.put('/api/v1/settings', {
			data: { fileManagerShowDeleteConfirmation: original.fileManagerShowDeleteConfirmation ?? true },
		});
		expect(restore.ok()).toBeTruthy();
	}
});
