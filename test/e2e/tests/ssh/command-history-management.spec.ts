import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { slowStep, step } from '../../support/steps';

const COMMAND_A = "printf 'HISTORY_MANAGED_A\\n'";
const COMMAND_B = "printf 'HISTORY_MANAGED_B\\n'";

function markerCount(text: string, marker: string): number {
  return text.split(marker).length - 1;
}

test('command history UI searches, copies, re-runs, and deletes real terminal history', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4173' });
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  const terminalRows = page.getByTestId('terminal').locator('.xterm-rows');
  const commandInput = page.getByTestId('command-input');
  const historyView = page.getByTestId('command-history-view');
  await expect(historyView).toBeVisible({ timeout: 20_000 });

  await slowStep('real terminal commands appear in history', async () => {
    await commandInput.fill(COMMAND_A);
    await commandInput.press('Enter');
    await commandInput.fill(COMMAND_B);
    await commandInput.press('Enter');
    await expect.poll(async () => terminalRows.innerText(), { timeout: 15_000 }).toContain('HISTORY_MANAGED_B');

    // Verify persistence first. This distinguishes backend history-write failures
    // from frontend refresh problems and protects rapid sequential submissions.
    await expect
      .poll(
        async () => {
          const response = await context.request.get('/api/v1/command-history');
          if (!response.ok()) return [];
          const items = (await response.json()) as Array<{ command: string }>;
          return items.map((item) => item.command).filter((command) => command.includes('HISTORY_MANAGED_'));
        },
        { timeout: 15_000 },
      )
      .toEqual(expect.arrayContaining([COMMAND_A, COMMAND_B]));

    await expect(
      historyView.locator('li[data-history-id]').filter({ hasText: 'HISTORY_MANAGED_A' }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      historyView.locator('li[data-history-id]').filter({ hasText: 'HISTORY_MANAGED_B' }).first(),
    ).toBeVisible();
  });

  await step('search filters unrelated history and copy writes the exact command to clipboard', async () => {
    const search = historyView.getByTestId('command-history-search');
    await search.fill('HISTORY_MANAGED_A');
    const rowA = historyView.locator('li[data-history-id]').filter({ hasText: 'HISTORY_MANAGED_A' }).first();
    await expect(rowA).toBeVisible();
    await expect(historyView.locator('li[data-history-id]').filter({ hasText: 'HISTORY_MANAGED_B' })).toHaveCount(0);

    await rowA.hover();
    await rowA.getByTestId('command-history-copy').click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(COMMAND_A);
  });

  await slowStep('clicking the filtered history entry re-runs it in the same SSH terminal', async () => {
    const rowA = historyView.locator('li[data-history-id]').filter({ hasText: 'HISTORY_MANAGED_A' }).first();
    const before = markerCount(await terminalRows.innerText(), 'HISTORY_MANAGED_A');
    await rowA.click();
    await expect
      .poll(async () => markerCount(await terminalRows.innerText(), 'HISTORY_MANAGED_A'), { timeout: 15_000 })
      .toBeGreaterThan(before);
  });

  await step('delete removes the individual history record from UI and backend persistence', async () => {
    const rowA = historyView.locator('li[data-history-id]').filter({ hasText: 'HISTORY_MANAGED_A' }).first();
    const historyId = Number(await rowA.getAttribute('data-history-id'));
    expect(historyId).toBeGreaterThan(0);
    await rowA.hover();
    await rowA.getByTestId('command-history-delete').click();
    await expect(rowA).toHaveCount(0);

    await expect
      .poll(async () => {
        const response = await context.request.get('/api/v1/command-history');
        if (!response.ok()) return true;
        const items = (await response.json()) as Array<{ id: number }>;
        return items.some((item) => item.id === historyId);
      })
      .toBeFalsy();
  });
});
