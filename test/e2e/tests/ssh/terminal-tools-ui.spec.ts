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
  const existing = await list.json() as Array<{ id: number; name?: string }>;
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
  const body = await create.json() as { command: { id: number } };
  return body.command.id;
}

function markerCount(text: string, marker: string): number {
  return text.split(marker).length - 1;
}

test('common terminal tools work through the real SSH session', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const settings = await context.request.put('/api/v1/settings', {
    data: {
      showQuickCommandTags: 'false',
      commandInputSyncTarget: 'none',
    },
  });
  expect(settings.ok()).toBeTruthy();
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

    const consoleLines: string[] = [];
    const onConsole = (message: { text(): string }) => consoleLines.push(message.text());
    page.on('console', onConsole);
    try {
      await commandBar.getByTitle('Open terminal search').click();
      await expect(commandInput).toHaveAttribute('placeholder', 'Search in terminal...');
      await commandInput.fill(marker);
      await expect.poll(() => {
        const callIndex = consoleLines.findIndex((line) => line.includes(`Calling findNext for term: "${marker}"`));
        if (callIndex < 0) return false;
        return consoleLines.slice(callIndex, callIndex + 4).some((line) => line.includes('findNext returned: true'));
      }, { timeout: 10_000 }).toBeTruthy();

      await commandBar.getByTitle('Find next').click();
      await commandBar.getByTitle('Find previous').click();
      await commandBar.getByTitle('Close terminal search').click();
      await expect(commandInput).toHaveAttribute('placeholder', 'Enter command and press Enter to send...');
    } finally {
      page.off('console', onConsole);
    }
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

    const historyView = page.getByTestId('command-history-view');
    const historyItem = historyView.locator('li[title]').filter({ hasText: marker }).first();
    await expect(historyItem).toBeVisible({ timeout: 20_000 });
    const before = markerCount(await rows.innerText(), marker);
    await historyItem.click();
    await expect.poll(async () => markerCount(await rows.innerText(), marker), { timeout: 15_000 })
      .toBeGreaterThan(before);
  });

  await step('Quick Commands executes a saved command in the active SSH session', async () => {
    const quickCommandsView = page.getByTestId('quick-commands-view');
    const commandRow = quickCommandsView.locator(`[data-command-id="${quickCommandId}"]`);
    await expect(commandRow).toBeVisible({ timeout: 20_000 });
    await commandRow.click();
    await expect.poll(async () => rows.innerText(), { timeout: 15_000 }).toContain('QUICK_UI_E2E');

    await expect.poll(async () => {
      const response = await context.request.get('/api/v1/quick-commands');
      if (!response.ok()) return 0;
      const commands = await response.json() as Array<{ id: number; usage_count?: number }>;
      return Number(commands.find((item) => item.id === quickCommandId)?.usage_count ?? 0);
    }).toBeGreaterThanOrEqual(1);
  });
});
