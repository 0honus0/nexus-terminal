import type { Page } from '@playwright/test';
import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { step } from '../../support/steps';

const SECONDARY_NAME = 'E2E Search Secondary';
const SECONDARY_HOST = 'search-target.invalid';
const WORKSPACE_TAG = 'E2E Workspace Tag With A Very Long Name For Narrow Mobile';
const WORKSPACE_TAG_RENAMED = 'E2E Workspace Tag Renamed For Narrow Mobile';

async function openWorkspaceConnectionPicker(page: Page) {
  await page.getByRole('button', { name: 'New Connection Tab', exact: true }).click();
  const list = page.getByTestId('workspace-connection-list');
  await expect(list).toBeVisible({ timeout: 20_000 });
  return list;
}

async function listTags(request: APIRequestContext): Promise<Array<{ id: number; name: string }>> {
  const response = await request.get('/api/v1/tags');
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Array<{ id: number; name: string }>;
}

async function connectionTagIds(request: APIRequestContext, id: number): Promise<number[]> {
  const response = await request.get(`/api/v1/connections/${id}`);
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { tagIds?: number[] }).tagIds ?? [];
}

async function recreateSecondaryConnection(request: APIRequestContext): Promise<number> {
  const list = await request.get('/api/v1/connections');
  expect(list.ok()).toBeTruthy();
  const connections = (await list.json()) as Array<{ id: number; name?: string }>;
  for (const connection of connections.filter((item) => item.name === SECONDARY_NAME)) {
    const remove = await request.delete(`/api/v1/connections/${connection.id}`);
    expect(remove.ok()).toBeTruthy();
  }

  const create = await request.post('/api/v1/connections', {
    data: {
      name: SECONDARY_NAME,
      type: 'SSH',
      host: SECONDARY_HOST,
      port: 22,
      username: 'search-e2e',
      authMethod: 'password',
      password: 'not-used-in-this-test',
    },
  });
  expect(create.status()).toBe(201);
  const body = (await create.json()) as { connection: { id: number } };
  return body.connection.id;
}

test('workspace connection search filters by name and host and restores the full list', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const settings = await context.request.put('/api/v1/settings', {
    data: { showConnectionTags: false },
  });
  expect(settings.ok()).toBeTruthy();
  await resetTestSshFilesystem();
  const primaryId = await ensureTestSshConnection(context.request);
  const secondaryId = await recreateSecondaryConnection(context.request);
  await connectTestSshFromConnectionsPage(page, primaryId);

  await page.getByTitle('Connections', { exact: true }).click();
  const list = page.getByTestId('workspace-connection-list');
  const search = list.locator('input[data-focus-id="connectionListSearch"]');
  const primaryRow = list.locator(`li[data-connection-id="${primaryId}"]`);
  const secondaryRow = list.locator(`li[data-connection-id="${secondaryId}"]`);

  await step('Connection search filters by display name', async () => {
    await expect(list).toBeVisible({ timeout: 20_000 });
    await expect(search).toBeVisible({ timeout: 20_000 });
    await expect(primaryRow).toBeVisible();
    await expect(secondaryRow).toBeVisible();
    await search.fill('Search Secondary');
    await expect(secondaryRow).toBeVisible();
    await expect(primaryRow).toHaveCount(0);
  });

  await step('Connection search also matches host and reports no-results cleanly', async () => {
    await search.fill('127.0.0.1');
    await expect(primaryRow).toBeVisible();
    await expect(secondaryRow).toHaveCount(0);

    await search.fill('definitely-no-connection-e2e');
    await expect(list.getByText(/No connections found matching/)).toBeVisible();
    await expect(primaryRow).toHaveCount(0);
    await expect(secondaryRow).toHaveCount(0);
  });

  await step('Clearing connection search restores all connections', async () => {
    await search.fill('');
    await expect(primaryRow).toBeVisible();
    await expect(secondaryRow).toBeVisible();
  });
});

test('workspace connection list remains usable when connection tags fail to load', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  expect(
    (
      await context.request.put('/api/v1/settings', {
        data: { showConnectionTags: true },
      })
    ).ok(),
  ).toBeTruthy();
  const primaryId = await ensureTestSshConnection(context.request);
  await page.route('**/api/v1/tags', (route) => route.abort('failed'));

  await page.goto('/workspace');
  const list = await openWorkspaceConnectionPicker(page);
  await expect(list.locator(`li[data-connection-id="${primaryId}"]`)).toBeVisible();
  await expect(
    page.getByText('Failed to load connection tags. Connections are still available.', { exact: true }),
  ).toBeVisible();
});

test('workspace connection list remains usable when main preferences fail to load', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const primaryId = await ensureTestSshConnection(context.request);
  await page.route('**/api/v1/settings', async (route) => {
    if (route.request().method() === 'GET') await route.abort('failed');
    else await route.continue();
  });

  await page.goto('/workspace');
  const list = await openWorkspaceConnectionPicker(page);
  await expect(list.locator(`li[data-connection-id="${primaryId}"]`)).toBeVisible();
  await expect(page.getByText('Network Error', { exact: true }).first()).toBeVisible();
});

test('workspace tag picker and group manager create, assign, remove, rename, and delete tags on narrow screens', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  expect(
    (
      await context.request.put('/api/v1/settings', {
        data: { showConnectionTags: true },
      })
    ).ok(),
  ).toBeTruthy();
  await resetTestSshFilesystem();
  const primaryId = await ensureTestSshConnection(context.request);
  const secondaryId = await recreateSecondaryConnection(context.request);
  for (const tag of (await listTags(context.request)).filter((item) =>
    [WORKSPACE_TAG, WORKSPACE_TAG_RENAMED].includes(item.name),
  )) {
    expect((await context.request.delete(`/api/v1/tags/${tag.id}`)).ok()).toBeTruthy();
  }

  await connectTestSshFromConnectionsPage(page, primaryId);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByTitle('Connections', { exact: true }).click();
  const list = page.getByTestId('workspace-connection-list');
  await expect(list).toBeVisible({ timeout: 20_000 });

  let tagId = 0;
  await step(
    'connection editor creates a long tag, Backspace only removes it locally, and exact Enter reselects it',
    async () => {
      const primaryRow = list.locator(`li[data-connection-id="${primaryId}"]`);
      await primaryRow.click({ button: 'right' });
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      const form = page.getByTestId('connection-form');
      await expect(form).toBeVisible();
      const tagInput = form.getByTestId('tag-input-text');
      await tagInput.fill(WORKSPACE_TAG);
      await tagInput.press('Enter');
      await expect
        .poll(async () => (await listTags(context.request)).find((tag) => tag.name === WORKSPACE_TAG)?.id ?? 0)
        .toBeGreaterThan(0);
      tagId = (await listTags(context.request)).find((tag) => tag.name === WORKSPACE_TAG)!.id;
      await expect(form.getByTestId('tag-chip').filter({ hasText: WORKSPACE_TAG })).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
        .toBeLessThanOrEqual(1);

      await tagInput.press('Backspace');
      await expect(form.getByTestId('tag-chip').filter({ hasText: WORKSPACE_TAG })).toHaveCount(0);
      expect((await listTags(context.request)).filter((tag) => tag.name === WORKSPACE_TAG)).toHaveLength(1);

      await tagInput.fill(WORKSPACE_TAG);
      await tagInput.press('Enter');
      await expect(form.getByTestId('tag-chip').filter({ hasText: WORKSPACE_TAG })).toBeVisible();
      expect((await listTags(context.request)).filter((tag) => tag.name === WORKSPACE_TAG)).toHaveLength(1);

      const save = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/connections/${primaryId}`) && response.request().method() === 'PUT',
      );
      await form.getByTestId('connection-submit-button').click();
      expect((await save).ok()).toBeTruthy();
      await expect(form).toBeHidden({ timeout: 15_000 });
      expect(await connectionTagIds(context.request, primaryId)).toContain(tagId);
    },
  );

  const openManager = async (name: string) => {
    const group = list.locator('section').filter({ hasText: name }).first();
    await expect(group).toBeVisible();
    await group.locator('header').hover();
    await group.getByTitle('Manage Tag').click();
    const content = page.getByTestId('workspace-tag-group-manager');
    await expect(content).toBeVisible();
    const dialog = page.getByRole('dialog').filter({ has: content });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(1);
    return dialog;
  };

  await step('group manager renames the tag and assigns the filtered secondary connection', async () => {
    const manager = await openManager(WORKSPACE_TAG);
    await manager.getByRole('textbox', { name: 'Tag Name' }).fill(WORKSPACE_TAG_RENAMED);
    await manager.getByTestId('tag-group-search').fill('Search Secondary');
    await manager.getByTestId('tag-group-select-all').click();
    await manager.getByTestId('tag-group-save').click();
    await expect(manager).toBeHidden({ timeout: 15_000 });
    await expect
      .poll(async () => (await listTags(context.request)).find((tag) => tag.id === tagId)?.name ?? '')
      .toBe(WORKSPACE_TAG_RENAMED);
    expect(await connectionTagIds(context.request, primaryId)).toContain(tagId);
    expect(await connectionTagIds(context.request, secondaryId)).toContain(tagId);
  });

  await step('filtered deselect removes one connection without deleting the tag', async () => {
    const manager = await openManager(WORKSPACE_TAG_RENAMED);
    await manager.getByTestId('tag-group-search').fill('127.0.0.1');
    await manager.getByTestId('tag-group-deselect-all').click();
    await manager.getByTestId('tag-group-save').click();
    await expect(manager).toBeHidden({ timeout: 15_000 });
    await expect.poll(async () => (await connectionTagIds(context.request, primaryId)).includes(tagId)).toBeFalsy();
    expect(await connectionTagIds(context.request, secondaryId)).toContain(tagId);
    expect((await listTags(context.request)).some((tag) => tag.id === tagId)).toBeTruthy();
  });

  await step('global delete is separately confirmed and removes the remaining association', async () => {
    const manager = await openManager(WORKSPACE_TAG_RENAMED);
    await manager.getByTestId('tag-group-delete').click();
    const confirm = page.getByRole('dialog', { name: 'Please confirm' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(manager).toBeHidden({ timeout: 15_000 });
    await expect.poll(async () => (await listTags(context.request)).some((tag) => tag.id === tagId)).toBeFalsy();
    await expect.poll(async () => (await connectionTagIds(context.request, secondaryId)).includes(tagId)).toBeFalsy();
  });
});
