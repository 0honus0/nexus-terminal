import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { closeWebSocket, openWorkspaceSession, requestWorkspace } from '../../support/ws';
import { slowStep, step } from '../../support/steps';

type SuspendedSession = {
  id: string;
  originalWorkspaceId: string;
  connectionName: string;
  customName?: string;
  status: 'active' | 'disconnected';
};

async function suspendedSessions(request: Parameters<typeof loginAsInitialAdmin>[0]): Promise<SuspendedSession[]> {
  const response = await request.get('/api/v1/ssh-suspend/suspended-sessions');
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as SuspendedSession[];
}

test('mobile UI marks a live SSH session for suspend and resumes the same shell after reload', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  const terminal = page.getByTestId('terminal');
  const rows = terminal.locator('.xterm-rows');
  const terminalText = async () => (await rows.locator(':scope > div').allTextContents()).join('');
  const commandInput = page.getByTestId('command-input');
  await expect(terminal).toBeVisible({ timeout: 20_000 });

  await step('prepare a shell state that must survive suspend and resume', async () => {
    await commandInput.fill('cd folder-seed');
    await commandInput.press('Enter');
    await commandInput.fill('printf \'BEFORE_SUSPEND=%s\\n\' "$PWD"');
    await commandInput.press('Enter');
    await expect.poll(terminalText, { timeout: 15_000 }).toContain('BEFORE_SUSPEND=');
    await expect.poll(terminalText, { timeout: 15_000 }).toContain('folder-seed');
  });

  let originalSessionId = '';
  let disposableOriginalSessionId = '';
  await step('mark the active terminal tab for suspend from its context menu', async () => {
    const tab = page
      .getByTestId('terminal-tab-bar')
      .locator('[data-session-id]')
      .filter({ hasText: 'E2E SSH' })
      .first();
    await expect(tab).toBeVisible();
    originalSessionId = (await tab.getAttribute('data-session-id')) ?? '';
    expect(originalSessionId).not.toBe('');

    await tab.click({ button: 'right' });
    await page.getByText('Suspend Session', { exact: true }).click();

    await tab.click({ button: 'right' });
    await expect(page.getByText('Unmark Suspend', { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
  });

  await step('prepare a second suspended session for destructive remove verification', async () => {
    const disposable = await openWorkspaceSession(
      context.request,
      connectionId,
      `suspend-remove-${crypto.randomUUID()}`,
    );
    disposableOriginalSessionId = disposable.workspaceId;
    await requestWorkspace(disposable.socket, 'suspend.mark');
    await closeWebSocket(disposable.socket);
    await expect
      .poll(
        async () =>
          (await suspendedSessions(context.request)).some(
            (session) => session.originalWorkspaceId === disposableOriginalSessionId && session.status === 'active',
          ),
        { timeout: 30_000 },
      )
      .toBeTruthy();
  });

  await step('the legacy suspended-session modal remains viewport-bounded on mobile', async () => {
    await page.getByTestId('open-suspended-sessions-button').click();
    const dialog = page.getByRole('dialog', { name: 'Suspended SSH Sessions', exact: true });
    await expect(dialog).toBeVisible();
    const viewport = page.viewportSize();
    const box = await dialog.boundingBox();
    expect(viewport).toBeTruthy();
    expect(box).toBeTruthy();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport!.width);
    const dialogRegion = dialog.getByRole('region', { name: 'Suspended SSH Sessions', exact: true });
    await expect(dialogRegion.locator('li').filter({ hasText: 'E2E SSH' }).first()).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
  });

  await slowStep('browser reload promotes the marked session to a backend hanging session', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect
      .poll(
        async () => {
          const sessions = await suspendedSessions(context.request);
          return sessions.some(
            (session) => session.originalWorkspaceId === originalSessionId && session.status === 'active',
          );
        },
        { timeout: 30_000 },
      )
      .toBeTruthy();
  });

  await slowStep('Suspended Sessions UI resumes the hanging shell instead of opening a new SSH shell', async () => {
    const manager = page.getByRole('region', { name: 'Suspended SSH Sessions', exact: true });
    await expect(manager).toBeVisible();
    const catalog = await suspendedSessions(context.request);
    const primary = catalog.find((session) => session.originalWorkspaceId === originalSessionId);
    const disposable = catalog.find((session) => session.originalWorkspaceId === disposableOriginalSessionId);
    expect(primary).toBeTruthy();
    expect(disposable).toBeTruthy();
    const hanging = manager.getByTestId(`suspended-session-${primary!.id}`);
    const disposableRow = manager.getByTestId(`suspended-session-${disposable!.id}`);
    await expect(hanging).toBeVisible({ timeout: 20_000 });
    await expect(disposableRow).toBeVisible({ timeout: 20_000 });
    await expect(manager.locator('i.fa-search')).toBeVisible();
    await expect(hanging.locator('i.fa-play')).toBeVisible();
    await expect(hanging.locator('i.fa-trash-alt')).toBeVisible();
    await expect(hanging.locator('i.fa-download')).toBeVisible();

    const search = manager.getByPlaceholder('Search sessions (name, connection...)');
    await search.fill('DOES_NOT_MATCH_SUSPEND_E2E');
    await expect(hanging).toBeHidden();
    await expect(manager).toContainText('No suspended sessions found matching your criteria.');
    await search.fill('E2E SSH');
    await expect(hanging).toBeVisible();

    await hanging.getByTitle('Click to edit name').click();
    const renameInput = hanging.locator('input[type="text"]');
    await expect(renameInput).toBeVisible();
    await renameInput.fill('E2E Renamed Suspended Shell');
    await renameInput.press('Enter');
    await expect(hanging).toContainText('E2E Renamed Suspended Shell');
    await expect
      .poll(
        async () =>
          (await suspendedSessions(context.request)).find((session) => session.id === primary!.id)?.customName,
      )
      .toBe('E2E Renamed Suspended Shell');

    const exportUrl = `**/api/v1/ssh-suspend/log/${primary!.id}`;
    await page.route(exportUrl, (route) => route.abort());
    await hanging.getByRole('button', { name: 'Export Log', exact: true }).click();
    await expect(page.getByText('Network Error', { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.unroute(exportUrl);
    expect((await suspendedSessions(context.request)).some((session) => session.id === primary!.id)).toBeTruthy();
    await expect(hanging).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await hanging.getByRole('button', { name: 'Export Log', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^ssh_log_.*\.log$/);
    const downloadStream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of downloadStream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString('utf8')).toContain('BEFORE_SUSPEND=');

    await disposableRow.getByRole('button', { name: 'Remove', exact: true }).click();
    const cancelConfirm = page.getByRole('dialog', { name: 'Please confirm' });
    await expect(cancelConfirm).toBeVisible();
    await cancelConfirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await suspendedSessions(context.request)).some((session) => session.id === disposable!.id)).toBeTruthy();
    await expect(disposableRow).toBeVisible();

    await disposableRow.getByRole('button', { name: 'Remove', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Please confirm' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect
      .poll(async () => (await suspendedSessions(context.request)).some((session) => session.id === disposable!.id))
      .toBeFalsy();
    await expect(disposableRow).toHaveCount(0);

    await hanging.getByRole('button', { name: 'Resume', exact: true }).click();

    await expect(
      page.getByTestId('terminal-tab-bar').locator('[data-session-id]').filter({ hasText: 'E2E SSH' }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(terminal).toBeVisible({ timeout: 30_000 });

    // A replacement terminal tab is mounted before the resume transaction is
    // fully committed. Wait for the suspended record to disappear so a command
    // cannot race the final resume handoff.
    await expect
      .poll(
        async () => {
          const sessions = await suspendedSessions(context.request);
          return sessions.some((session) => session.originalWorkspaceId === originalSessionId);
        },
        { timeout: 30_000 },
      )
      .toBeFalsy();

    const resumedInput = page.getByTestId('command-input');
    await resumedInput.fill('printf \'AFTER_RESUME=%s\\n\' "$PWD"');
    await resumedInput.press('Enter');
    await expect.poll(async () => rows.innerText(), { timeout: 20_000 }).toContain('AFTER_RESUME=');
    await expect.poll(async () => rows.innerText(), { timeout: 20_000 }).toContain('folder-seed');
  });
});
