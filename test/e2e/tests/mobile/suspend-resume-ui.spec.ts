import { expect, test } from '@playwright/test';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { slowStep, step } from '../../support/steps';

type SuspendedSession = {
  suspendSessionId: string;
  originalSessionId?: string;
  connectionName: string;
  backendSshStatus: 'marked_active' | 'hanging' | 'disconnected_by_backend';
};

async function suspendedSessions(request: Parameters<typeof loginAsInitialAdmin>[0]): Promise<SuspendedSession[]> {
  const response = await request.get('/api/v1/ssh-suspend/suspended-sessions');
  expect(response.ok()).toBeTruthy();
  return await response.json() as SuspendedSession[];
}

test('mobile UI marks a live SSH session for suspend and resumes the same shell after reload', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  const terminal = page.getByTestId('terminal');
  const rows = terminal.locator('.xterm-rows');
  const commandInput = page.getByTestId('command-input');
  await expect(terminal).toBeVisible({ timeout: 20_000 });

  await step('prepare a shell state that must survive suspend and resume', async () => {
    await commandInput.fill('cd folder-seed');
    await commandInput.press('Enter');
    await commandInput.fill("printf 'BEFORE_SUSPEND=%s\\n' \"$PWD\"");
    await commandInput.press('Enter');
    await expect.poll(async () => rows.innerText(), { timeout: 15_000 }).toContain('folder-seed');
  });

  let originalSessionId = '';
  await step('mark the active terminal tab for suspend from its context menu', async () => {
    const tab = page.getByTestId('terminal-tab-bar').locator('li[data-session-id]').filter({ hasText: 'E2E SSH' }).first();
    await expect(tab).toBeVisible();
    originalSessionId = (await tab.getAttribute('data-session-id')) ?? '';
    expect(originalSessionId).not.toBe('');

    await tab.click({ button: 'right' });
    await page.getByText('Suspend Session', { exact: true }).click();

    await tab.click({ button: 'right' });
    await expect(page.getByText('Unmark Suspend', { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
  });

  await slowStep('browser reload promotes the marked session to a backend hanging session', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(async () => {
      const sessions = await suspendedSessions(context.request);
      return sessions.some((session) => session.originalSessionId === originalSessionId && session.backendSshStatus === 'hanging');
    }, { timeout: 30_000 }).toBeTruthy();
  });

  await slowStep('Suspended Sessions UI resumes the hanging shell instead of opening a new SSH shell', async () => {
    const openButton = page.getByTestId('open-suspended-sessions-button');
    await expect(openButton).toBeVisible({ timeout: 20_000 });
    await openButton.click();

    const manager = page.getByTestId('suspended-sessions-view');
    await expect(manager).toBeVisible();
    const hanging = manager.locator('li[data-suspend-id]').filter({ hasText: 'E2E SSH' }).filter({ hasText: 'Active' }).first();
    await expect(hanging).toBeVisible({ timeout: 20_000 });
    await hanging.getByRole('button', { name: 'Resume', exact: true }).click();

    await expect(page.getByTestId('terminal-tab-bar').locator('li[data-session-id]').filter({ hasText: 'E2E SSH' }).first())
      .toBeVisible({ timeout: 30_000 });
    await expect(terminal).toBeVisible({ timeout: 30_000 });

    // A replacement terminal tab is mounted before the resume transaction is
    // fully committed. Wait for the backend hanging record to disappear so a
    // command cannot race the final resume/ACK handoff.
    await expect.poll(async () => {
      const sessions = await suspendedSessions(context.request);
      return sessions.some((session) => session.originalSessionId === originalSessionId);
    }, { timeout: 30_000 }).toBeFalsy();

    const resumedInput = page.getByTestId('command-input');
    await resumedInput.fill("printf 'AFTER_RESUME=%s\\n' \"$PWD\"");
    await resumedInput.press('Enter');
    await expect.poll(async () => rows.innerText(), { timeout: 20_000 }).toContain('AFTER_RESUME=');
    await expect.poll(async () => rows.innerText(), { timeout: 20_000 }).toContain('folder-seed');
  });
});
