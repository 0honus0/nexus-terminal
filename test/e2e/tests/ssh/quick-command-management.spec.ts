import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { slowStep, step } from '../../support/steps';

const ORIGINAL_NAME = 'E2E Managed Quick Command';
const EDITED_NAME = 'E2E Managed Quick Command Edited';

async function cleanupCommands(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/v1/quick-commands');
  expect(response.ok()).toBeTruthy();
  const commands = await response.json() as Array<{ id: number; name?: string }>;
  for (const command of commands.filter((item) => item.name === ORIGINAL_NAME || item.name === EDITED_NAME)) {
    const remove = await request.delete(`/api/v1/quick-commands/${command.id}`);
    expect(remove.ok()).toBeTruthy();
  }
}

async function findCommand(request: APIRequestContext, name: string): Promise<{ id: number; command: string; usage_count?: number } | undefined> {
  const response = await request.get('/api/v1/quick-commands');
  expect(response.ok()).toBeTruthy();
  return (await response.json() as Array<{ id: number; name?: string; command: string; usage_count?: number }>).find((item) => item.name === name);
}

function markerCount(text: string, marker: string): number {
  return text.split(marker).length - 1;
}

test('quick command UI creates, searches, executes, edits, and deletes a command', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const settings = await context.request.put('/api/v1/settings', { data: { showQuickCommandTags: 'false' } });
  expect(settings.ok()).toBeTruthy();
  await cleanupCommands(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  const quickView = page.getByTestId('quick-commands-view');
  const terminalRows = page.getByTestId('terminal').locator('.xterm-rows');
  await expect(quickView).toBeVisible({ timeout: 20_000 });

  let commandId = 0;
  await step('create the command through the workspace UI', async () => {
    await quickView.getByTestId('quick-command-add').click();
    const form = page.getByTestId('quick-command-form');
    await expect(form).toBeVisible();
    await form.getByTestId('quick-command-name').fill(ORIGINAL_NAME);
    await form.getByTestId('quick-command-command').fill("printf 'QUICK_MANAGED_V1\\n'");
    await form.getByTestId('quick-command-submit').click();
    await expect(form).toBeHidden({ timeout: 15_000 });

    await expect.poll(async () => (await findCommand(context.request, ORIGINAL_NAME))?.id ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
    commandId = (await findCommand(context.request, ORIGINAL_NAME))!.id;
  });

  await slowStep('search narrows the list and the saved command executes in the live SSH terminal', async () => {
    const search = quickView.getByTestId('quick-command-search');
    await search.fill('Managed Quick Command');
    const row = quickView.locator(`[data-command-id="${commandId}"]`);
    await expect(row).toBeVisible();
    const before = markerCount(await terminalRows.innerText(), 'QUICK_MANAGED_V1');
    await row.click();
    await expect.poll(async () => markerCount(await terminalRows.innerText(), 'QUICK_MANAGED_V1'), { timeout: 15_000 }).toBeGreaterThan(before);
    await expect.poll(async () => Number((await findCommand(context.request, ORIGINAL_NAME))?.usage_count ?? 0)).toBeGreaterThanOrEqual(1);
  });

  await step('edit updates both the name and command body', async () => {
    const row = quickView.locator(`[data-command-id="${commandId}"]`);
    await row.click({ button: 'right' });
    const menu = page.locator('.quick-command-context-menu');
    await expect(menu).toBeVisible();
    await menu.getByText('Edit', { exact: true }).click();

    const form = page.getByTestId('quick-command-form');
    await expect(form.getByTestId('quick-command-name')).toHaveValue(ORIGINAL_NAME);
    await form.getByTestId('quick-command-name').fill(EDITED_NAME);
    await form.getByTestId('quick-command-command').fill("printf 'QUICK_MANAGED_V2\\n'");
    await form.getByTestId('quick-command-submit').click();
    await expect(form).toBeHidden({ timeout: 15_000 });

    await expect.poll(async () => (await findCommand(context.request, EDITED_NAME))?.command ?? '', { timeout: 15_000 })
      .toContain('QUICK_MANAGED_V2');
  });

  await slowStep('edited command executes and delete removes it from UI and persistence', async () => {
    const search = quickView.getByTestId('quick-command-search');
    await search.fill('Edited');
    const row = quickView.locator(`[data-command-id="${commandId}"]`);
    await expect(row).toBeVisible();
    await row.click();
    await expect.poll(async () => terminalRows.innerText(), { timeout: 15_000 }).toContain('QUICK_MANAGED_V2');

    await row.click({ button: 'right' });
    const menu = page.locator('.quick-command-context-menu');
    await menu.getByText('Delete', { exact: true }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: EDITED_NAME });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect.poll(async () => await findCommand(context.request, EDITED_NAME)).toBeUndefined();
  });
});
