import {
	readCommandMutation,
	readCommandTagMutation,
} from '../../../../packages/shared/src/preferences/commands/http-codec';
import { listTestCommands, cleanupTestCommand, cleanupTestCommandTag } from '../../support/commands';
import { E2E_URLS } from '../../support/test-env';
import { writeFile } from 'node:fs/promises';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin, updateUiPreferences } from '../../support/auth';
import {
	configureSshE2eSettings,
	connectTestSshFromConnectionsPage,
	ensureTestSshConnection,
	resetTestSshFilesystem,
} from '../../support/ssh';
import { slowStep, step } from '../../support/steps';

const ORIGINAL_NAME = 'E2E Managed Quick Command';
const EDITED_NAME = 'E2E Managed Quick Command Edited';
const TAG_FAILURE_NAME = 'E2E Quick Command Tag Failure';
const TAG_FAILURE_TAG = 'E2E Quick Command Failure Tag';

async function cleanupCommands(request: APIRequestContext): Promise<void> {
	const commands = await listTestCommands(request);
	for (const command of commands.filter((item) =>
		[ORIGINAL_NAME, EDITED_NAME, TAG_FAILURE_NAME].includes(item.name ?? ''),
	)) {
		await cleanupTestCommand(request, command.id);
	}
}

async function findCommand(
	request: APIRequestContext,
	name: string,
): Promise<{ id: number; command: string; usageCount?: number } | undefined> {
	return (await listTestCommands(request)).find((item) => item.name === name);
}

function markerCount(text: string, marker: string): number {
	return text.split(marker).length - 1;
}

async function captureQuickCommandsEvidence(page: Page, testInfo: TestInfo, name: 'before' | 'after'): Promise<void> {
	const metrics = await page
		.locator('.quick-commands-root')
		.filter({ visible: true })
		.first()
		.evaluate((quickView) => {
			const list = quickView.querySelector<HTMLElement>('.quick-command-list-area');
			const search = quickView.querySelector<HTMLElement>('.quick-commands-search');
			const add = quickView.querySelector<HTMLElement>('.quick-control--primary');

			const rect = (element: Element | null) => {
				if (!element) return null;
				const box = element.getBoundingClientRect();
				return {
					x: box.x,
					y: box.y,
					width: box.width,
					height: box.height,
					right: box.right,
					bottom: box.bottom,
				};
			};

			return {
				language: document.documentElement.lang,
				viewport: { width: window.innerWidth, height: window.innerHeight },
				pageScrollWidth: document.documentElement.scrollWidth,
				bodyScrollWidth: document.body.scrollWidth,
				quickView: rect(quickView ?? null),
				list: rect(list ?? null),
				listClientWidth: list?.clientWidth ?? 0,
				listScrollWidth: list?.scrollWidth ?? 0,
				listClientHeight: list?.clientHeight ?? 0,
				listScrollHeight: list?.scrollHeight ?? 0,
				search: rect(search ?? null),
				add: rect(add ?? null),
				commandCount: quickView?.querySelectorAll('[data-command-id]').length ?? 0,
				backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--app-bg-color').trim(),
			};
		});
	const screenshotPath = testInfo.outputPath(`quick-command-${name}.png`);
	const metricsPath = testInfo.outputPath(`quick-command-${name}.metrics.json`);
	await page.screenshot({ path: screenshotPath, fullPage: false, animations: 'disabled', caret: 'hide' });
	await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
	await testInfo.attach(`M09.03-a quick command ${name} screenshot`, {
		path: screenshotPath,
		contentType: 'image/png',
	});
	await testInfo.attach(`M09.03-a quick command ${name} metrics`, {
		path: metricsPath,
		contentType: 'application/json',
	});
	console.log(
		`[M09.03-a quick command ${name} metrics] language=${metrics.language} viewport=${metrics.viewport.width}x${metrics.viewport.height} pageScrollWidth=${metrics.pageScrollWidth} bodyScrollWidth=${metrics.bodyScrollWidth} list=${metrics.listClientWidth}/${metrics.listScrollWidth}/${metrics.listClientHeight}/${metrics.listScrollHeight} commands=${metrics.commandCount}`,
	);
	expect(metrics.language).toMatch(/^en(?:-US)?$/);
	expect(metrics.viewport).toEqual({ width: 1280, height: 800 });
	expect(metrics.pageScrollWidth).toBeLessThanOrEqual(metrics.viewport.width);
	expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.viewport.width);
	expect(metrics.quickView?.x).toBeGreaterThanOrEqual(0);
	expect(metrics.quickView?.right).toBeLessThanOrEqual(metrics.viewport.width + 1);
	expect(metrics.list?.width).toBeGreaterThan(0);
	expect(metrics.search?.width).toBeGreaterThan(0);
	expect(metrics.add?.width).toBeGreaterThan(0);
}

test('quick command UI creates, searches, executes, edits, and deletes a command', async ({
	page,
	context,
}, testInfo) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await updateUiPreferences(context.request, (preferences) => {
		preferences.showQuickCommandTags = false;
	});

	await cleanupCommands(context.request);
	await resetTestSshFilesystem();
	const connectionId = await ensureTestSshConnection(context.request);
	await connectTestSshFromConnectionsPage(page, connectionId);

	const quickView = page.locator('.quick-commands-root').filter({ visible: true }).first();
	const terminalRows = page.locator('.terminal-inner-container .xterm-rows');
	await expect(quickView).toBeVisible({ timeout: 20_000 });
	await page.setViewportSize({ width: 1280, height: 800 });
	await captureQuickCommandsEvidence(page, testInfo, 'before');

	let commandId = 0;
	let defaultDialogSize: { width: number; height: number } | null = null;
	await step('create the command through the workspace UI', async () => {
		await quickView.getByRole('button', { name: 'Add', exact: true }).click();
		const form = page.getByRole('dialog', { name: 'Add Quick Command', exact: true }).locator('form');
		await expect(form).toBeVisible();
		const dialog = page.getByRole('dialog', { name: 'Add Quick Command', exact: true });
		const beforeResize = await dialog.boundingBox();
		const resizeHandle = dialog.getByLabel('Resize quick command window', { exact: true });
		const handleBox = await resizeHandle.boundingBox();
		expect(beforeResize).toBeTruthy();
		expect(handleBox).toBeTruthy();
		defaultDialogSize = { width: beforeResize!.width, height: beforeResize!.height };
		await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
		await page.mouse.down();
		await page.mouse.move(handleBox!.x + 70, handleBox!.y + 50, { steps: 6 });
		await page.mouse.up();
		const afterResize = await dialog.boundingBox();
		expect(afterResize).toBeTruthy();
		expect(afterResize!.width).toBeGreaterThan(beforeResize!.width + 40);
		expect(afterResize!.height).toBeGreaterThan(beforeResize!.height + 30);
		expect(afterResize!.x).toBeGreaterThanOrEqual(0);
		expect(afterResize!.y).toBeGreaterThanOrEqual(0);
		expect(afterResize!.x + afterResize!.width).toBeLessThanOrEqual(1280);
		expect(afterResize!.y + afterResize!.height).toBeLessThanOrEqual(800);
		await form.getByPlaceholder('Optional, for quick identification', { exact: true }).fill(ORIGINAL_NAME);
		await form.locator('textarea[required]').fill("printf 'QUICK_MANAGED_V1\\n'");
		await form.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(form).toBeHidden({ timeout: 15_000 });

		await expect
			.poll(async () => (await findCommand(context.request, ORIGINAL_NAME))?.id ?? 0, { timeout: 15_000 })
			.toBeGreaterThan(0);
		commandId = (await findCommand(context.request, ORIGINAL_NAME))!.id;
	});

	await slowStep('search narrows the list and the saved command executes in the live SSH terminal', async () => {
		const search = quickView.getByPlaceholder('Search name or command...', { exact: true });
		await search.fill('Managed Quick Command');
		const row = quickView.locator(`[data-command-id="${commandId}"]`);
		await expect(row).toBeVisible();
		await expect(row.locator('.quick-command-row-actions, .row-action')).toHaveCount(0);
		await row.click({ button: 'right' });
		const contextMenu = page.getByRole('menu').filter({ visible: true }).first();
		await expect(contextMenu).toBeVisible();
		await expect(contextMenu.getByText('Copy', { exact: true })).toBeVisible();
		await expect(contextMenu.getByText('Edit', { exact: true })).toBeVisible();
		await expect(contextMenu.getByText('Delete', { exact: true })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(contextMenu).toBeHidden();
		const before = markerCount(await terminalRows.innerText(), 'QUICK_MANAGED_V1');
		await row.click();
		await expect
			.poll(async () => markerCount(await terminalRows.innerText(), 'QUICK_MANAGED_V1'), { timeout: 15_000 })
			.toBeGreaterThan(before);
		await expect
			.poll(async () => Number((await findCommand(context.request, ORIGINAL_NAME))?.usageCount ?? 0))
			.toBeGreaterThanOrEqual(1);
	});

	await step('edit updates both the name and command body', async () => {
		const row = quickView.locator(`[data-command-id="${commandId}"]`);
		await row.click({ button: 'right' });
		const menu = page.getByRole('menu').filter({ visible: true }).first();
		await expect(menu).toBeVisible();
		await menu.getByText('Edit', { exact: true }).click();

		const form = page.getByRole('dialog', { name: 'Edit Quick Command', exact: true }).locator('form');
		await expect(form.getByPlaceholder('Optional, for quick identification', { exact: true })).toHaveValue(
			ORIGINAL_NAME,
		);
		const reopenedDialog = page.getByRole('dialog', { name: 'Edit Quick Command', exact: true });
		const reopenedBox = await reopenedDialog.boundingBox();
		expect(reopenedBox).toBeTruthy();
		expect(defaultDialogSize).toBeTruthy();
		expect(Math.abs(reopenedBox!.width - defaultDialogSize!.width)).toBeLessThan(2);
		expect(Math.abs(reopenedBox!.height - defaultDialogSize!.height)).toBeLessThan(2);
		await form.getByPlaceholder('Optional, for quick identification', { exact: true }).fill(EDITED_NAME);
		await form.locator('textarea[required]').fill("printf 'QUICK_MANAGED_V2\\n'");
		await form.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(form).toBeHidden({ timeout: 15_000 });

		await expect
			.poll(async () => (await findCommand(context.request, EDITED_NAME))?.command ?? '', { timeout: 15_000 })
			.toContain('QUICK_MANAGED_V2');
	});

	await slowStep('edited command executes and delete removes it from UI and persistence', async () => {
		const search = quickView.getByPlaceholder('Search name or command...', { exact: true });
		await search.fill('Edited');
		const row = quickView.locator(`[data-command-id="${commandId}"]`);
		await expect(row).toBeVisible();
		await row.click();
		await expect.poll(async () => terminalRows.innerText(), { timeout: 15_000 }).toContain('QUICK_MANAGED_V2');
		await captureQuickCommandsEvidence(page, testInfo, 'after');

		await row.click({ button: 'right' });
		const menu = page.getByRole('menu').filter({ visible: true }).first();
		await menu.getByText('Delete', { exact: true }).click();
		const confirm = page.getByRole('dialog', { name: 'Please confirm' });
		await expect(confirm).toContainText(EDITED_NAME);
		await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
		await expect(row).toHaveCount(0);
		await expect.poll(async () => await findCommand(context.request, EDITED_NAME)).toBeUndefined();
	});
});

test('quick commands remain usable when the tag catalog fails to load', async ({ page, context }) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await updateUiPreferences(context.request, (preferences) => {
		preferences.showQuickCommandTags = true;
	});
	await cleanupCommands(context.request);
	await resetTestSshFilesystem();

	const createTag = await context.request.post('/api/v1/quick-command-tags', {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: { name: TAG_FAILURE_TAG },
	});
	expect(createTag.status()).toBe(201);
	const tagId = readCommandTagMutation(await createTag.json()).tag.id;
	const create = await context.request.post('/api/v1/quick-commands', {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: {
			name: TAG_FAILURE_NAME,
			command: "printf 'QUICK_TAG_FAILURE_FALLBACK\\n'",
			tagIds: [tagId],
			variables: {},
		},
	});
	expect(create.status()).toBe(201);
	const commandId = readCommandMutation(await create.json()).command.id;
	const connectionId = await ensureTestSshConnection(context.request);

	let rejectedTagReads = 0;
	await page.route('**/api/v1/quick-command-tags?*', async (route) => {
		if (route.request().method() === 'GET') {
			rejectedTagReads += 1;
			await route.abort('failed');
		} else await route.continue();
	});

	try {
		await connectTestSshFromConnectionsPage(page, connectionId);
		const quickView = page.locator('.quick-commands-root').filter({ visible: true }).first();
		const row = quickView.locator(`[data-command-id="${commandId}"]`);
		// Tags are an optional read owner. The command directory itself did
		// not fail, so it does not show a false directory-wide error alert.
		await expect.poll(() => rejectedTagReads).toBeGreaterThan(0);
		await expect(row).toBeVisible();
		await expect(quickView.getByText('Untagged', { exact: true })).toBeVisible();

		const terminalRows = page.locator('.terminal-inner-container .xterm-rows');
		const before = markerCount(await terminalRows.innerText(), 'QUICK_TAG_FAILURE_FALLBACK');
		await row.click();
		await expect
			.poll(async () => markerCount(await terminalRows.innerText(), 'QUICK_TAG_FAILURE_FALLBACK'), {
				timeout: 15_000,
			})
			.toBeGreaterThan(before);
		await page.unroute('**/api/v1/quick-command-tags?*');
		await quickView.getByRole('button', { name: 'Retry', exact: true }).click();
		await expect(quickView.getByRole('alert')).toHaveCount(0);
		await expect(quickView.getByText(TAG_FAILURE_TAG, { exact: true })).toBeVisible();
	} finally {
		await cleanupTestCommand(context.request, commandId);
		await cleanupTestCommandTag(context.request, tagId);
	}
});
