import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { step } from '../../support/steps';

const QUICK_COMMAND_NAME = 'E2E UI Quick Command';

async function recreateQuickCommand(request: APIRequestContext): Promise<number> {
  const list = await request.get('/api/v1/quick-commands');
  expect(list.ok()).toBeTruthy();
  const existing = (await list.json()) as Array<{ id: number; name?: string }>;
  for (const command of existing.filter((item) => item.name === QUICK_COMMAND_NAME)) {
    const remove = await request.delete(`/api/v1/quick-commands/${command.id}`);
    expect(remove.ok()).toBeTruthy();
  }

  const create = await request.post('/api/v1/quick-commands', {
    data: {
      name: QUICK_COMMAND_NAME,
      command: "printf 'QUICK_UI_E2E\\n'",
      tagIds: [],
      variables: {},
    },
  });
  expect(create.status()).toBe(201);
  const body = (await create.json()) as { command: { id: number } };
  return body.command.id;
}

function markerCount(text: string, marker: string): number {
  return text.split(marker).length - 1;
}

test('common terminal tools work through the real SSH session', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const settings = await context.request.put('/api/v1/settings', {
    data: { commandInputSyncTarget: 'none' },
  });
  expect(settings.ok()).toBeTruthy();
  const tagVisibility = await context.request.put('/api/v1/settings/show-quick-command-tags', {
    data: { enabled: false },
  });
  expect(tagVisibility.ok()).toBeTruthy();
  await resetTestSshFilesystem();
  const quickCommandId = await recreateQuickCommand(context.request);
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  const terminal = page.getByTestId('terminal');
  const rows = terminal.locator('.xterm-rows');
  const commandInput = page.getByTestId('command-input');
  const commandBar = page.getByTestId('command-input-bar');

  await expect(terminal).toBeVisible({ timeout: 20_000 });
  await expect(commandInput).toBeVisible();

  await step('Terminal search finds output and supports previous/next navigation', async () => {
    const marker = 'TERMINAL_SEARCH_UI_E2E';
    await commandInput.fill(`printf '${marker}\\n${marker}\\n'`);
    await commandInput.press('Enter');
    await expect.poll(async () => rows.innerText(), { timeout: 15_000 }).toContain(marker);

    await terminal.getByTitle('Search terminal').click();
    const searchInput = terminal.getByPlaceholder('Search terminal...');
    await expect(searchInput).toBeVisible();
    await searchInput.fill(marker);
    await terminal.getByTitle('Find next').click();
    await terminal.getByTitle('Find previous').click();
    await terminal.getByTitle('Close search').click();
    await expect(searchInput).toBeHidden();
    await expect(commandInput).toHaveAttribute('placeholder', 'Enter command and press Enter to send...');
  });

  await step('Clear Terminal removes previously rendered output from the viewport', async () => {
    const marker = 'CLEAR_TERMINAL_UI_E2E';
    await commandInput.fill(`printf '${marker}\\n'`);
    await commandInput.press('Enter');
    await expect.poll(async () => rows.innerText(), { timeout: 15_000 }).toContain(marker);
    await commandBar.getByTitle('Clear Terminal').click();
    await expect.poll(async () => rows.innerText()).not.toContain(marker);
  });

  await step('Command History records a command and can execute it again', async () => {
    const marker = 'HISTORY_UI_E2E';
    const command = `printf '${marker}\\n'`;
    await commandInput.fill(command);
    await commandInput.press('Enter');
    await expect.poll(async () => rows.innerText(), { timeout: 15_000 }).toContain(marker);

    const historyView = page.getByTestId('command-history-view').filter({ visible: true }).first();
    const historyItem = historyView.locator('li[title]').filter({ hasText: marker }).first();
    await expect(historyItem).toBeVisible({ timeout: 20_000 });
    const before = markerCount(await rows.innerText(), marker);
    await historyItem.getByTestId('command-history-execute').click();
    await expect
      .poll(async () => markerCount(await rows.innerText(), marker), { timeout: 15_000 })
      .toBeGreaterThan(before);
  });

  await step('Quick Commands executes a saved command in the active SSH session', async () => {
    const quickCommandsView = page.getByTestId('quick-commands-view').filter({ visible: true }).first();
    const commandRow = quickCommandsView.locator(`[data-command-id="${quickCommandId}"]`);
    await expect(commandRow).toBeVisible({ timeout: 20_000 });
    await commandRow.getByTestId('quick-command-execute').click();
    await expect.poll(async () => rows.innerText(), { timeout: 15_000 }).toContain('QUICK_UI_E2E');

    await expect
      .poll(async () => {
        const response = await context.request.get('/api/v1/quick-commands');
        if (!response.ok()) return 0;
        const commands = (await response.json()) as Array<{ id: number; usageCount?: number }>;
        return Number(commands.find((item) => item.id === quickCommandId)?.usageCount ?? 0);
      })
      .toBeGreaterThanOrEqual(1);
  });
});
