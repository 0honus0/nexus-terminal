import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { getUiPreferences, loginAsInitialAdmin, updateUiPreferences } from '../../support/auth';
import { readCommandMutation } from '../../../../packages/shared/src/preferences/commands/http-codec';
import { listTestCommands, removeTestCommand } from '../../support/commands';
import {
	readCommandHistoryList,
	readHistoryAddResponse,
} from '../../../../packages/shared/src/preferences/history/http-codec';
import { E2E_URLS } from '../../support/test-env';
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
	const commands = await listTestCommands(request);
	for (const command of commands.filter((item) => item.name === QUICK_COMMAND_NAME)) {
		await removeTestCommand(request, command);
	}

	const create = await request.post('/api/v1/quick-commands', {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: {
			name: QUICK_COMMAND_NAME,
			command: `printf '${QUICK_COMMAND_MARKER}\\n'`,
			tagIds: [],
			variables: {},
		},
	});
	expect(create.status()).toBe(201);
	return readCommandMutation(await create.json()).command.id;
}

test('command input sync setting drives quick-command search and keyboard execution in a live SSH session', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await resetTestSshFilesystem();

	const original = (await getUiPreferences(context.request)).preferences;
	await updateUiPreferences(context.request, (preferences) => {
		preferences.commandInputSyncTarget = 'none';
		preferences.quickCommandsCollapsibleSearch = false;
		preferences.showQuickCommandTags = false;
	});

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
				(response) =>
					response.url().endsWith('/api/v1/settings/preferences') && response.request().method() === 'PUT',
			);
			await commandsGroup.getByRole('button', { name: 'Save group', exact: true }).click();
			expect((await responsePromise).ok()).toBeTruthy();

			expect((await getUiPreferences(context.request)).preferences.commandInputSyncTarget).toBe('quickCommands');
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
		await updateUiPreferences(context.request, (preferences) => {
			preferences.commandInputSyncTarget = original.commandInputSyncTarget;
			preferences.quickCommandsCollapsibleSearch = original.quickCommandsCollapsibleSearch;
			preferences.showQuickCommandTags = original.showQuickCommandTags;
		});
		const command = (await listTestCommands(context.request)).find((item) => item.id === commandId);
		if (!command) throw new Error('Quick command disappeared before cleanup');
		await removeTestCommand(context.request, command);
	}
});

test('command input sync filters command history and executes the keyboard selection in a live SSH session', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await resetTestSshFilesystem();

	const original = (await getUiPreferences(context.request)).preferences;
	const historyCommand = `printf '${COMMAND_HISTORY_SYNC_MARKER}\\n'`;

	const existingHistory = await context.request.get('/api/v1/command-history?limit=50&offset=0');
	expect(existingHistory.ok()).toBeTruthy();
	for (const entry of readCommandHistoryList(await existingHistory.json(), { limit: 50, offset: 0 }).entries) {
		if (entry.command !== historyCommand) continue;
		expect(
			(
				await context.request.delete(`/api/v1/command-history/${entry.id}`, {
					headers: { Origin: E2E_URLS.frontendOrigin },
				})
			).ok(),
		).toBeTruthy();
	}

	const createHistory = await context.request.post('/api/v1/command-history', {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: { command: historyCommand },
	});
	expect(createHistory.status()).toBe(201);
	const historyId = readHistoryAddResponse(await createHistory.json()).id;
	await updateUiPreferences(context.request, (preferences) => {
		preferences.commandInputSyncTarget = 'commandHistory';
	});

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
		await updateUiPreferences(context.request, (preferences) => {
			preferences.commandInputSyncTarget = original.commandInputSyncTarget;
		});

		const history = await context.request.get('/api/v1/command-history?limit=50&offset=0');
		expect(history.ok()).toBeTruthy();
		for (const entry of readCommandHistoryList(await history.json(), { limit: 50, offset: 0 }).entries) {
			if (entry.command !== historyCommand) continue;
			const remove = await context.request.delete(`/api/v1/command-history/${entry.id}`, {
				headers: { Origin: E2E_URLS.frontendOrigin },
			});
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

	const original = (await getUiPreferences(context.request)).preferences;
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
				(response) =>
					response.url().endsWith('/api/v1/settings/preferences') && response.request().method() === 'PUT',
			);
			await filesGroup.getByRole('button', { name: 'Save group', exact: true }).click();
			expect((await responsePromise).ok()).toBeTruthy();

			expect((await getUiPreferences(context.request)).preferences.fileManagerShowDeleteConfirmation).toBe(false);
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
		await updateUiPreferences(context.request, (preferences) => {
			preferences.fileManagerShowDeleteConfirmation = original.fileManagerShowDeleteConfirmation;
		});
	}
});
