import { expect, test, type Page, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin, updateUiPreferences, getUiPreferences } from '../../support/auth';
import { getTestLayout, getTestSidebar, updateTestLayout } from '../../support/presentation';
import { E2E_URLS } from '../../../support/protocols/test-environment';
import { configureSshE2eSettings, ensureTestSshConnection, connectTestSshFromConnectionsPage } from '../../support/ssh';
import { readPresentationUpdateResponse } from '../../../../packages/shared/src/preferences/presentation/http-codec';

test.use({ e2eServices: ['ssh'] });

const workspaceEndpoint = '**/api/v1/settings/workspace-layout';

const editor = (page: Page) => page.getByRole('dialog', { name: 'Layout Configurator', exact: true });

const saveButton = (page: Page) => editor(page).getByRole('button', { name: /^Save\*/ });

async function openEditor(page: Page, request: APIRequestContext): Promise<void> {
	await loginAsInitialAdmin(request);
	await updateUiPreferences(request, (preferences) => {
		preferences.language = 'en-US';
		preferences.layoutLocked = false;
		preferences.navBarVisible = true;
		preferences.showWorkspaceLayoutConfigurator = true;
	});
	const current = await getTestLayout(request);
	const response = await request.put('/api/v1/settings/workspace-layout', {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: {
			expectedVersion: current.version,
			layout: {
				id: 'conflict-root',
				type: 'container',
				direction: 'vertical',
				size: 100,
				children: [
					{ id: 'conflict-terminal', type: 'pane', component: 'terminal', size: 90 },
					{ id: 'conflict-command', type: 'pane', component: 'commandBar', size: 10 },
				],
			},
			sidebar: { left: ['connections'], right: [] },
		},
	});
	expect(response.status()).toBe(200);
	expect(readPresentationUpdateResponse(await response.json()).version).toBe(current.version + 1);
	await configureSshE2eSettings(request);
	const connectionId = await ensureTestSshConnection(request);
	await connectTestSshFromConnectionsPage(page, connectionId);
	await page.getByRole('button', { name: 'Configure Layout', exact: true }).click();
	await expect(editor(page).locator('[data-node-id="conflict-root"]')).toBeVisible();
}

async function removeSidebar(page: Page): Promise<void> {
	await editor(page)
		.locator('.layout-sidebar-list')
		.first()
		.getByRole('button', { name: 'Remove', exact: true })
		.click();
	await expect(
		editor(page).locator('.layout-sidebar-list').first().getByRole('button', { name: 'Remove', exact: true }),
	).toHaveCount(0);
	await expect(saveButton(page)).toBeEnabled();
}

test('layout drafts save after locking without closing and reopening the editor', async ({ page, context }) => {
	await openEditor(page, context.request);
	const before = await getTestLayout(context.request);
	const lock = editor(page).getByRole('switch', { name: 'Lock Layout', exact: true });
	await lock.click();
	await expect(lock).toHaveAttribute('aria-checked', 'true');
	await expect.poll(async () => (await getUiPreferences(context.request)).preferences.layoutLocked).toBe(true);
	await removeSidebar(page);
	const writes: number[] = [];
	await page.route(workspaceEndpoint, async (route) => {
		writes.push(route.request().postDataJSON().expectedVersion);
		await route.continue();
	});
	await saveButton(page).click();
	await expect(editor(page)).toBeHidden();
	expect(writes).toEqual([before.version + 1]);
	expect((await getTestSidebar(context.request)).sidebar).toEqual({ left: [], right: [] });
	expect((await getUiPreferences(context.request)).preferences.layoutLocked).toBe(true);
	await page.reload();
	await connectTestSshFromConnectionsPage(page, await ensureTestSshConnection(context.request));
	await page.getByRole('button', { name: 'Configure Layout', exact: true }).click();
	await expect(
		editor(page).locator('.layout-sidebar-list').getByRole('button', { name: 'Remove', exact: true }),
	).toHaveCount(0);
	await expect(editor(page).getByRole('switch', { name: 'Lock Layout', exact: true })).toHaveAttribute(
		'aria-checked',
		'true',
	);
});

test('a rejected layout save rereads unrelated remote preferences and retries once', async ({ page, context }) => {
	await openEditor(page, context.request);
	await removeSidebar(page);
	const before = await getTestLayout(context.request);
	await updateUiPreferences(context.request, (preferences) => {
		preferences.layoutLocked = true;
	});
	const writes: number[] = [];
	await page.route(workspaceEndpoint, async (route) => {
		writes.push(route.request().postDataJSON().expectedVersion);
		await route.continue();
	});
	await saveButton(page).click();
	await expect(editor(page)).toBeHidden();
	expect(writes).toEqual([before.version, before.version + 1]);
	expect((await getTestLayout(context.request)).layout).toEqual(before.layout);
	expect((await getTestSidebar(context.request)).sidebar).toEqual({ left: [], right: [] });
	expect((await getUiPreferences(context.request)).preferences.layoutLocked).toBe(true);
});

test('a real remote layout change preserves the draft and requires an explicit refresh', async ({ page, context }) => {
	await openEditor(page, context.request);
	await removeSidebar(page);
	const before = await getTestLayout(context.request);
	const remote = structuredClone(before.layout);
	if (remote.type !== 'container') throw new Error('Expected fixture container');
	remote.direction = 'horizontal';
	await updateTestLayout(context.request, remote);
	let writes = 0;
	await page.route(workspaceEndpoint, async (route) => {
		writes++;
		await route.continue();
	});
	await saveButton(page).click();
	const refresh = editor(page).getByRole('button', { name: 'Refresh', exact: true });
	await expect(refresh).toBeVisible();
	await expect(saveButton(page)).toBeEnabled();
	expect(writes).toBe(1);
	expect((await getTestLayout(context.request)).layout).toEqual(remote);
	expect((await getTestSidebar(context.request)).sidebar.left).toEqual(['connections']);
	await expect(
		editor(page).locator('.layout-sidebar-list').first().getByRole('button', { name: 'Remove', exact: true }),
	).toHaveCount(0);
	await saveButton(page).click();
	await expect(saveButton(page)).toBeEnabled();
	expect(writes).toBe(1);
	await refresh.click();
	await expect(refresh).toBeHidden();
	await expect(editor(page).locator('[data-node-id="conflict-root"] > [data-layout-direction]')).toHaveAttribute(
		'data-layout-direction',
		'horizontal',
	);
	await removeSidebar(page);
	await saveButton(page).click();
	await expect(editor(page)).toBeHidden();
	expect(writes).toBe(2);
	expect((await getTestLayout(context.request)).layout).toEqual(remote);
	expect((await getTestSidebar(context.request)).sidebar.left).toEqual([]);
});

test('a committed layout save with a lost response is never automatically replayed', async ({ page, context }) => {
	await openEditor(page, context.request);
	await removeSidebar(page);
	const before = await getTestLayout(context.request);
	let writes = 0;
	await page.route(workspaceEndpoint, async (route) => {
		writes++;
		const response = await route.fetch();
		expect(response.status()).toBe(200);
		await route.abort('failed');
	});
	await saveButton(page).click();
	await expect(editor(page).getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
	await expect(saveButton(page)).toBeEnabled();
	expect(writes).toBe(1);
	expect((await getTestSidebar(context.request)).sidebar.left).toEqual([]);
	expect((await getTestLayout(context.request)).version).toBe(before.version + 1);
	await saveButton(page).click();
	await expect(saveButton(page)).toBeEnabled();
	expect(writes).toBe(1);
	expect((await getTestLayout(context.request)).version).toBe(before.version + 1);
});

test('layout recovery stops after a second confirmed conflict', async ({ page, context }) => {
	await openEditor(page, context.request);
	await removeSidebar(page);
	let writes = 0;
	await page.route(workspaceEndpoint, async (route) => {
		writes++;
		await updateUiPreferences(context.request, (preferences) => {
			preferences.layoutLocked = !preferences.layoutLocked;
		});
		await route.continue();
	});
	await saveButton(page).click();
	await expect(editor(page).getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
	await expect(saveButton(page)).toBeEnabled();
	expect(writes).toBe(2);
	expect((await getTestSidebar(context.request)).sidebar.left).toEqual(['connections']);
	await saveButton(page).click();
	await expect(saveButton(page)).toBeEnabled();
	expect(writes).toBe(2);
});
