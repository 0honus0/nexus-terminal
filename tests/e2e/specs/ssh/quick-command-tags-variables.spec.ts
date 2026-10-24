import type { Request } from '@playwright/test';
import {
	listTestCommandTags,
	listTestCommands,
	cleanupTestCommand,
	cleanupTestCommandTag,
} from '../../support/commands';
import { E2E_URLS } from '../../support/test-env';
import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin, updateUiPreferences } from '../../support/auth';
import {
	configureSshE2eSettings,
	connectTestSshFromConnectionsPage,
	ensureTestSshConnection,
	resetTestSshFilesystem,
} from '../../support/ssh';
import { slowStep, step } from '../../support/steps';

const COMMAND_NAME = 'E2E Tagged Variable Command';
const TAG_NAME = 'E2E Quick Variable Tag';
const RENAMED_TAG = 'E2E Quick Variable Tag Renamed';
const HIDDEN_NAME = 'E2E Secondary Group Command';
const OUTSIDE_NAME = 'E2E Outside Group Command';
const SHARED_TAG = 'E2E Quick Shared Tag';

async function cleanup(request: APIRequestContext): Promise<void> {
	const failures: unknown[] = [];
	for (const command of await listTestCommands(request)) {
		if ([COMMAND_NAME, HIDDEN_NAME, OUTSIDE_NAME].includes(command.name ?? '')) {
			try {
				await cleanupTestCommand(request, command.id);
			} catch (cause) {
				failures.push(cause);
			}
		}
	}
	for (const tag of await listTestCommandTags(request)) {
		if ([TAG_NAME, RENAMED_TAG, SHARED_TAG].includes(tag.name)) {
			try {
				await cleanupTestCommandTag(request, tag.id);
			} catch (cause) {
				failures.push(cause);
			}
		}
	}
	if (failures.length) {
		throw new AggregateError(failures, 'Quick command fixture cleanup failed');
	}
}

test('quick command tags and saved variables survive persistence, grouping, rename, and real SSH execution', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await updateUiPreferences(context.request, (preferences) => {
		preferences.language = 'en-US';
	});
	await updateUiPreferences(context.request, (preferences) => {
		preferences.showQuickCommandTags = true;
	});
	await cleanup(context.request);
	await resetTestSshFilesystem();
	const connectionId = await ensureTestSshConnection(context.request);
	await connectTestSshFromConnectionsPage(page, connectionId);

	let commandId = 0;
	let tagId = 0;

	try {
		const quickView = page.locator('.quick-commands-root:visible').first();
		const terminalRows = page.locator('.terminal-inner-container .xterm-rows');
		await expect(quickView).toBeVisible({ timeout: 20_000 });

		await step(
			'quick command toolbar controls shrink with a narrow workspace pane without horizontal overflow',
			async () => {
				const controls = quickView.locator('.quick-commands-controls');
				const buttons = controls.locator('.quick-control');
				const wideButtonWidth = (await buttons.first().boundingBox())?.width ?? 0;
				expect(wideButtonWidth).toBeGreaterThan(0);

				await page.setViewportSize({ width: 900, height: 700 });
				await expect(quickView).toBeVisible();
				const narrowMetrics = await controls.evaluate((element) => ({
					clientWidth: element.clientWidth,
					scrollWidth: element.scrollWidth,
				}));
				const narrowButtonWidth = (await buttons.first().boundingBox())?.width ?? 0;
				expect(narrowMetrics.scrollWidth).toBeLessThanOrEqual(narrowMetrics.clientWidth + 1);
				expect(narrowButtonWidth).toBeLessThanOrEqual(wideButtonWidth);

				await page.setViewportSize({ width: 1440, height: 900 });
				await expect(quickView).toBeVisible();
			},
		);

		await step('create a tagged command with a persisted substitution variable', async () => {
			await quickView.getByRole('button', { name: 'Add', exact: true }).click();
			const form = page.getByRole('dialog', { name: 'Add Quick Command', exact: true });
			await expect(form).toBeVisible();
			await form.getByPlaceholder('Optional, for quick identification', { exact: true }).fill(COMMAND_NAME);
			await form.locator('textarea').fill("printf 'QC_TAG_VARIABLE_%s\\n' '${WHO}'");
			await form.getByRole('button', { name: 'Add variable', exact: true }).click();
			await form.getByPlaceholder('Variable Name', { exact: true }).fill('WHO');
			await form.getByPlaceholder('Variable Value', { exact: true }).fill('NEXUS');

			const tagInput = form.getByPlaceholder('Select or create tags...', { exact: true });
			await tagInput.fill(TAG_NAME);
			await tagInput.press('Enter');
			await expect
				.poll(
					async () => {
						const tag = (await listTestCommandTags(context.request)).find((item) => item.name === TAG_NAME);
						return tag?.id ?? 0;
					},
					{ timeout: 15_000 },
				)
				.toBeGreaterThan(0);

			tagId = (await listTestCommandTags(context.request)).find((item) => item.name === TAG_NAME)!.id;
			await expect(form.locator('.ui-token-input__token').filter({ hasText: TAG_NAME })).toBeVisible();
			await form.getByRole('button', { name: 'Save', exact: true }).click();
			await expect(form).toBeHidden({ timeout: 15_000 });

			await expect
				.poll(async () => {
					const command = (await listTestCommands(context.request)).find(
						(item) => item.name === COMMAND_NAME,
					);
					return command?.id ?? 0;
				})
				.toBeGreaterThan(0);

			commandId = (await listTestCommands(context.request)).find((item) => item.name === COMMAND_NAME)!.id;
		});

		await step(
			'narrow grouped commands keep the first tag close to the toolbar even at a large row scale',
			async () => {
				await page.setViewportSize({ width: 900, height: 700 });
				const controls = quickView.locator('.quick-commands-controls');
				const list = quickView.locator('.quick-command-list-area');
				const group = quickView
					.locator('.quick-command-group-card')
					.filter({ has: page.getByRole('button', { name: TAG_NAME, exact: true }) });
				const header = group.locator('.quick-command-group-header');
				const name = group.getByRole('button', { name: TAG_NAME, exact: true });
				await expect(group).toBeVisible();

				const originalHeaderHeight = (await header.boundingBox())!.height;
				const topPadding = await list.evaluate((element) =>
					Number.parseFloat(getComputedStyle(element).paddingTop),
				);
				await list.evaluate((element) => element.style.setProperty('--quick-row-scale', '2.5'));
				const spacing = await Promise.all([
					controls.boundingBox(),
					list.boundingBox(),
					header.boundingBox(),
					name.boundingBox(),
				]);
				const [controlsBox, listBox, headerBox, nameBox] = spacing;
				expect(controlsBox).not.toBeNull();
				expect(listBox).not.toBeNull();
				expect(headerBox).not.toBeNull();
				expect(nameBox).not.toBeNull();
				expect(Math.abs(headerBox!.y - listBox!.y - topPadding)).toBeLessThanOrEqual(2);
				expect(headerBox!.height).toBe(originalHeaderHeight);
				expect(nameBox!.y).toBeGreaterThanOrEqual(headerBox!.y);
				expect(nameBox!.y + nameBox!.height).toBeLessThanOrEqual(headerBox!.y + headerBox!.height);
				expect(listBox!.y).toBeGreaterThanOrEqual(controlsBox!.y + controlsBox!.height - 1);

				await list.evaluate((element) => element.style.removeProperty('--quick-row-scale'));
				await page.setViewportSize({ width: 1440, height: 900 });
				await expect(quickView).toBeVisible();
			},
		);

		await step('tag text toggles the group and only the context menu enters rename mode', async () => {
			const group = quickView
				.locator('.quick-command-group-card')
				.filter({ has: page.locator(`[data-command-id="${commandId}"]`) });
			const header = group.locator('.quick-command-group-header');
			const name = group.getByRole('button', { name: TAG_NAME, exact: true });
			const toggle = group.locator('button[aria-expanded]').first();
			await expect(header).toBeVisible();
			await expect(name).toBeVisible();

			const headerBox = await header.boundingBox();
			const nameBox = await name.boundingBox();
			expect(headerBox).toBeTruthy();
			expect(nameBox).toBeTruthy();
			expect(nameBox!.x + nameBox!.width).toBeLessThan(headerBox!.x + headerBox!.width - 2);

			if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
			await header.click({ position: { x: headerBox!.width - 20, y: headerBox!.height / 2 } });
			await expect(toggle).toHaveAttribute('aria-expanded', 'false');
			await header.click({ position: { x: headerBox!.width - 20, y: headerBox!.height / 2 } });
			await expect(toggle).toHaveAttribute('aria-expanded', 'true');
			const row = quickView.locator(`[data-command-id="${commandId}"]`);
			await expect(row).toBeVisible();
			const rowPresentation = await row.evaluate((element) => ({
				selected: element.classList.contains('bg-primary/20'),
				userSelect: getComputedStyle(element).userSelect,
				fontSize: Number.parseFloat(
					getComputedStyle(element.querySelector<HTMLElement>('.quick-command-display-text')!).fontSize,
				),
				fontWeight: Number.parseInt(
					getComputedStyle(element.querySelector<HTMLElement>('.quick-command-display-text')!).fontWeight,
					10,
				),
				monospaceClass: element
					.querySelector<HTMLElement>('.quick-command-display-text')!
					.classList.contains('font-mono'),
			}));
			expect(rowPresentation.selected).toBe(false);
			expect(rowPresentation.userSelect).toBe('none');
			expect(rowPresentation.fontSize).toBe(12);
			expect(rowPresentation.fontWeight).toBeGreaterThanOrEqual(500);
			expect(rowPresentation.monospaceClass).toBe(false);

			await name.click();
			await expect(group.getByRole('textbox')).toHaveCount(0);
			await name.click({ button: 'right' });
			await page.getByRole('menuitem', { name: 'Rename tag', exact: true }).click();
			const input = group.getByRole('textbox');
			await expect(input).toBeVisible();
			await input.press('Escape');
			await expect(input).toHaveCount(0);
		});

		await slowStep(
			'the saved variable is substituted when the grouped command executes in the live terminal',
			async () => {
				const group = quickView
					.locator('.quick-command-group-card')
					.filter({ has: page.locator(`[data-command-id="${commandId}"]`) });
				await expect(group).toContainText(TAG_NAME, { timeout: 15_000 });
				const groupToggle = group.locator('button[aria-expanded]').first();
				if ((await groupToggle.getAttribute('aria-expanded')) === 'false') await groupToggle.click();
				const row = quickView.locator(`[data-command-id="${commandId}"]`);
				await expect(row).toBeVisible();
				await row.locator('.quick-command-display-text').click();
				await expect
					.poll(async () => terminalRows.innerText(), { timeout: 15_000 })
					.toContain('QC_TAG_VARIABLE_NEXUS');

				const saved = (await listTestCommands(context.request)).find((item) => item.id === commandId);
				expect(saved?.tagIds).toContain(tagId);
				expect(saved?.variables).toMatchObject({ WHO: 'NEXUS' });
			},
		);

		await step('context menu tag rename persists and keeps the command in the renamed group', async () => {
			const group = quickView
				.locator('.quick-command-group-card')
				.filter({ has: page.locator(`[data-command-id="${commandId}"]`) });
			await group.getByRole('button', { name: TAG_NAME, exact: true }).click({ button: 'right' });
			await page.getByRole('menuitem', { name: 'Rename tag', exact: true }).click();
			const input = group.getByRole('textbox');
			await expect(input).toBeVisible();
			await input.fill(RENAMED_TAG);
			await input.press('Enter');

			await expect
				.poll(async () => {
					return (await listTestCommandTags(context.request)).find((item) => item.id === tagId)?.name ?? '';
				})
				.toBe(RENAMED_TAG);
			await expect(group.getByRole('button', { name: RENAMED_TAG, exact: true })).toHaveText(RENAMED_TAG);
		});

		await step(
			'group deletion covers hidden and shared commands, confirms once, and preserves other groups',
			async () => {
				async function addCommand(name: string, tagNames: string[]): Promise<void> {
					await quickView.getByRole('button', { name: 'Add', exact: true }).click();
					const form = page.getByRole('dialog', { name: 'Add Quick Command', exact: true });
					await form.getByPlaceholder('Optional, for quick identification', { exact: true }).fill(name);
					await form.locator('textarea').fill('printf GROUP_DELETE_E2E');
					for (const tag of tagNames) {
						const input = form.getByPlaceholder('Select or create tags...', { exact: true });
						await input.fill(tag);
						await input.press('Enter');
						await expect(form.locator('.ui-token-input__token').filter({ hasText: tag })).toBeVisible();
					}
					await form.getByRole('button', { name: 'Save', exact: true }).click();
					await expect(form).toBeHidden();
				}

				await addCommand(HIDDEN_NAME, [RENAMED_TAG, SHARED_TAG]);
				await addCommand(OUTSIDE_NAME, [SHARED_TAG]);
				const original = await listTestCommands(context.request);
				const members = original.filter((command) => command.tagIds.includes(tagId));
				expect(members).toHaveLength(2);
				const tag = (await listTestCommandTags(context.request)).find((item) => item.id === tagId);
				if (!tag) throw new Error('Missing group before deletion');
				const deletePath = `/api/v1/quick-command-tags/${tagId}/group`;
				const headers = { Origin: E2E_URLS.frontendOrigin };
				// Membership or command changes reject the entire transaction before any deletion.
				for (const commands of [
					[],
					members.map((command) => ({ id: command.id, expectedVersion: command.version + 1 })),
				]) {
					const conflict = await context.request.delete(deletePath, {
						headers,
						data: { expectedVersion: tag.version, commands },
					});
					expect(conflict.status()).toBe(409);
					expect((await listTestCommands(context.request)).map((command) => command.id)).toEqual(
						original.map((command) => command.id),
					);
					expect((await listTestCommandTags(context.request)).some((item) => item.id === tagId)).toBe(true);
				}
				await quickView.getByPlaceholder('Search name or command...', { exact: true }).fill(COMMAND_NAME);
				await expect(quickView.locator(`[data-command-id="${commandId}"]`)).toBeVisible();
				await expect(quickView.getByText(HIDDEN_NAME, { exact: true })).toHaveCount(0);
				const tagName = quickView.getByRole('button', { name: RENAMED_TAG, exact: true });
				const deletions: string[] = [];

				const observeDelete = (request: Request) => {
					if (request.method() === 'DELETE' && new URL(request.url()).pathname === deletePath)
						deletions.push(request.postData() ?? '');
				};

				page.on('request', observeDelete);
				try {
					await tagName.click({ button: 'right' });
					const menu = page.getByRole('menu').filter({ visible: true });
					await menu.getByRole('menuitem', { name: 'Delete group and commands', exact: true }).click();
					const confirm = page.getByRole('dialog', { name: 'Please confirm' });
					await expect(confirm).toContainText(RENAMED_TAG);
					await expect(confirm).toContainText('all 2 quick commands');
					await expect(confirm).toContainText('also be removed from other tag groups');
					expect(deletions).toHaveLength(0);
					await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
					await expect(confirm).toBeHidden();
					expect((await listTestCommands(context.request)).map((command) => command.id)).toEqual(
						original.map((command) => command.id),
					);
					expect(deletions).toHaveLength(0);

					await tagName.click({ button: 'right' });
					await menu.getByRole('menuitem', { name: 'Delete group and commands', exact: true }).click();
					await expect(confirm).toBeVisible();
					const pending = page.waitForResponse(
						(response) =>
							response.request().method() === 'DELETE' && new URL(response.url()).pathname === deletePath,
					);
					await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
					expect((await pending).status()).toBe(200);
					await expect(tagName).toHaveCount(0);
					const remaining = await listTestCommands(context.request);
					expect(remaining.some((command) => members.some((member) => member.id === command.id))).toBe(false);
					expect(remaining.find((command) => command.name === OUTSIDE_NAME)).toEqual(
						original.find((command) => command.name === OUTSIDE_NAME),
					);
					const tags = await listTestCommandTags(context.request);
					expect(tags.some((item) => item.id === tagId)).toBe(false);
					expect(tags.some((item) => item.name === SHARED_TAG)).toBe(true);
					await quickView.getByPlaceholder('Search name or command...', { exact: true }).fill('');
					await expect(quickView.getByRole('button', { name: SHARED_TAG, exact: true })).toBeVisible();
					expect(deletions).toHaveLength(1);
				} finally {
					page.off('request', observeDelete);
				}
			},
		);
	} finally {
		await cleanup(context.request);
	}
});
