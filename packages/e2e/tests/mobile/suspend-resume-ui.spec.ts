import { expect, test, type Page } from '../../support/fixtures';
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

async function dragTerminalDown(page: Page): Promise<void> {
  const terminal = page.getByTestId('terminal').getByTestId('terminal-inner');
  const box = await terminal.boundingBox();
  expect(box).toBeTruthy();
  const x = box!.x + box!.width / 2;
  const startY = box!.y + Math.min(56, box!.height / 5);
  const endY = Math.min(box!.y + box!.height - 12, startY + Math.min(260, box!.height * 0.55));
  await terminal.evaluate(
    (element, gesture) => {
      const target = element as HTMLElement;
      const touch = (y: number, force = 0.5) =>
        new Touch({
          identifier: 23,
          target,
          clientX: gesture.x,
          clientY: y,
          pageX: gesture.x,
          pageY: y,
          screenX: gesture.x,
          screenY: y,
          radiusX: 8,
          radiusY: 8,
          rotationAngle: 0,
          force,
        });
      const dispatch = (type: 'touchstart' | 'touchmove' | 'touchend', active: Touch[], changed: Touch[]) =>
        target.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: active,
            targetTouches: active,
            changedTouches: changed,
          }),
        );
      const start = touch(gesture.startY);
      dispatch('touchstart', [start], [start]);
      for (let index = 1; index <= 5; index += 1) {
        const moved = touch(gesture.startY + ((gesture.endY - gesture.startY) * index) / 5);
        dispatch('touchmove', [moved], [moved]);
      }
      dispatch('touchend', [], [touch(gesture.endY, 0)]);
    },
    { x, startY, endY },
  );
}

test('mobile suspended catalog refreshes promptly after the immediate suspend handoff', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  const tab = page.getByTestId('terminal-tab-bar').locator('[data-session-id]').filter({ hasText: 'E2E SSH' }).first();
  await expect(tab).toBeVisible();
  const originalWorkspaceId = (await tab.getAttribute('data-session-id')) ?? '';
  expect(originalWorkspaceId).not.toBe('');

  // Prime the shared catalog while it is still empty. Reopening/mounting a suspended-session
  // view after the handoff must not trust this cached result.
  await page.getByTestId('open-suspended-sessions-button').click();
  const dialog = page.getByRole('dialog', { name: 'Suspended SSH Sessions', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('suspended-sessions-modal-body')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();

  let suspendedId = '';
  try {
    await tab.click({ button: 'right' });
    await page.getByText('Suspend Session', { exact: true }).click();
    await expect(tab).toHaveCount(0);

    const emptySuspendedPanel = page.getByTestId('mobile-empty-suspended-panel');
    await expect(emptySuspendedPanel).toBeVisible();
    const handedOffRow = emptySuspendedPanel
      .locator('[data-testid^="suspended-session-"]')
      .filter({ hasText: 'E2E SSH' })
      .first();
    await expect(handedOffRow).toBeVisible({ timeout: 2_500 });

    await expect
      .poll(
        async () => {
          const match = (await suspendedSessions(context.request)).find(
            (session) => session.originalWorkspaceId === originalWorkspaceId && session.status === 'active',
          );
          suspendedId = match?.id ?? '';
          return Boolean(match);
        },
        { timeout: 5_000 },
      )
      .toBeTruthy();
  } finally {
    if (!suspendedId) {
      const match = (await suspendedSessions(context.request)).find(
        (session) => session.originalWorkspaceId === originalWorkspaceId,
      );
      suspendedId = match?.id ?? '';
    }
    if (suspendedId) {
      const cleanup = await context.request.delete(`/api/v1/ssh-suspend/terminate/${encodeURIComponent(suspendedId)}`);
      expect([200, 404]).toContain(cleanup.status());
    }
  }
});

test('mobile resumed terminal loads older suspended output when dragged downward', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  const original = await openWorkspaceSession(
    context.request,
    connectionId,
    `mobile-resume-history-${crypto.randomUUID()}`,
  );
  const earlyMarker = 'MOBILE_RESUME_HISTORY_EARLY';
  const tailMarker = 'MOBILE_RESUME_HISTORY_TAIL';
  // Keep raw retained history just above 256 KiB without manufacturing thousands of visible rows.
  // Repeated SGR state changes consume log bytes while each trailing CRLF advances only one row.
  // A few downward drags can therefore reach the lazy-history boundary and fetch the page with earlyMarker.
  const ansiStateLine = `${'\x1b[38;5;196m'.repeat(520)}\x1b[0m`;
  const filler = Array.from({ length: 46 }, () => ansiStateLine);
  const snapshot = `${earlyMarker}\r\n${filler.join('\r\n')}\r\n${tailMarker}\r\n`;
  expect(Buffer.byteLength(snapshot)).toBeGreaterThan(256 * 1024);
  expect(Buffer.byteLength(snapshot)).toBeLessThan(320 * 1024);

  await requestWorkspace(original.socket, 'suspend.mark', { terminalSnapshot: snapshot });
  await closeWebSocket(original.socket);

  let suspended: SuspendedSession | undefined;
  await expect
    .poll(
      async () => {
        suspended = (await suspendedSessions(context.request)).find(
          (session) => session.originalWorkspaceId === original.workspaceId && session.status === 'active',
        );
        return Boolean(suspended);
      },
      { timeout: 30_000 },
    )
    .toBeTruthy();

  await page.goto('/workspace');
  const manager = page.getByRole('region', { name: 'Suspended SSH Sessions', exact: true });
  const hanging = manager.getByTestId(`suspended-session-${suspended!.id}`);
  await expect(hanging).toBeVisible({ timeout: 20_000 });
  await hanging.getByRole('button', { name: 'Resume', exact: true }).click();
  // The cached binary tail can render before suspend.resume has returned. Wait for the
  // UI-level completion signal so previous-history availability is installed before the
  // synthetic swipe starts; real touch gestures naturally happen after this point.
  await expect(page.getByText(/resumed successfully\.$/)).toBeVisible({ timeout: 20_000 });

  const terminal = page.getByTestId('terminal');
  const rows = terminal.locator('.xterm-rows');
  await expect(terminal).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => rows.innerText(), { timeout: 20_000 }).toContain(tailMarker);
  await expect(rows).not.toContainText(earlyMarker);

  // Native touch scrolling moves terminal content with the finger, so dragging downward navigates
  // toward older output. The first gesture can land on the currently loaded history boundary while
  // the previous page is fetched. Prepending intentionally preserves that viewport anchor, so a
  // following downward gesture is what navigates into the newly inserted rows.
  for (let attempt = 0; attempt < 6 && !(await rows.innerText()).includes(earlyMarker); attempt += 1) {
    await dragTerminalDown(page);
    await page.waitForTimeout(250);
  }
  await expect.poll(async () => rows.innerText(), { timeout: 20_000 }).toContain(earlyMarker);

  const resumedTab = page
    .getByTestId('terminal-tab-bar')
    .locator('[data-session-id]')
    .filter({ hasText: 'E2E SSH' })
    .first();
  await resumedTab.click({ button: 'right' });
  await expect(page.getByText('Unmark Suspend', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByText('Unmark Suspend', { exact: true }).click();
});

test('mobile resume replaces an immediately suspended tab without exposing a temporary duplicate', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  const tabBar = page.getByTestId('terminal-tab-bar');
  const tab = tabBar.locator('[data-session-id]').filter({ hasText: 'E2E SSH' }).first();
  await expect(tab).toBeVisible({ timeout: 20_000 });
  const originalSessionId = (await tab.getAttribute('data-session-id')) ?? '';
  expect(originalSessionId).not.toBe('');

  await page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('[data-testid="terminal-tab-bar"]');
    if (!bar) throw new Error('Terminal tab bar not found.');
    const state = { maxTabs: bar.querySelectorAll('[data-session-id]').length };
    const observer = new MutationObserver(() => {
      state.maxTabs = Math.max(state.maxTabs, bar.querySelectorAll('[data-session-id]').length);
    });
    observer.observe(bar, { childList: true, subtree: true });
    (
      window as typeof window & { __suspendTabObserver?: MutationObserver; __suspendTabState?: typeof state }
    ).__suspendTabObserver = observer;
    (window as typeof window & { __suspendTabState?: typeof state }).__suspendTabState = state;
  });

  try {
    await tab.click({ button: 'right' });
    await page.getByText('Suspend Session', { exact: true }).click();
    await expect(tab).toHaveCount(0);

    let suspended: SuspendedSession | undefined;
    await expect
      .poll(
        async () => {
          suspended = (await suspendedSessions(context.request)).find(
            (session) => session.originalWorkspaceId === originalSessionId && session.status === 'active',
          );
          return Boolean(suspended);
        },
        { timeout: 30_000 },
      )
      .toBeTruthy();

    const manager = page.getByTestId('mobile-empty-suspended-panel');
    await expect(manager).toBeVisible();
    const hanging = manager.getByTestId(`suspended-session-${suspended!.id}`);
    await expect(hanging).toBeVisible({ timeout: 20_000 });
    await hanging.getByRole('button', { name: 'Resume', exact: true }).click();

    await expect.poll(() => tabBar.locator('[data-session-id]').count(), { timeout: 30_000 }).toBe(1);
    await expect
      .poll(async () => (await suspendedSessions(context.request)).some((session) => session.id === suspended!.id), {
        timeout: 30_000,
      })
      .toBeFalsy();

    const maxTabs = await page.evaluate(() => {
      return (window as typeof window & { __suspendTabState?: { maxTabs: number } }).__suspendTabState?.maxTabs ?? 0;
    });
    expect(maxTabs).toBe(1);
    await expect(tabBar.locator('[data-session-id]').filter({ hasText: 'E2E SSH' }).first()).toBeVisible();
  } finally {
    await page.evaluate(() => {
      const target = window as typeof window & { __suspendTabObserver?: MutationObserver; __suspendTabState?: unknown };
      target.__suspendTabObserver?.disconnect();
      delete target.__suspendTabObserver;
      delete target.__suspendTabState;
    });
  }
});

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
  let primarySuspendedId = '';
  let disposableOriginalSessionId = '';
  await step('suspend the active terminal immediately while delayed PTY output remains pending', async () => {
    const tab = page
      .getByTestId('terminal-tab-bar')
      .locator('[data-session-id]')
      .filter({ hasText: 'E2E SSH' })
      .first();
    await expect(tab).toBeVisible();
    originalSessionId = (await tab.getAttribute('data-session-id')) ?? '';
    expect(originalSessionId).not.toBe('');

    await commandInput.fill('(sleep 0.5; printf \'AFTER_SUSPEND=%s\\n\' "$PWD") &');
    await commandInput.press('Enter');
    await tab.click({ button: 'right' });
    await page.getByText('Suspend Session', { exact: true }).click();
    await expect(tab).toHaveCount(0);

    await expect
      .poll(
        async () => {
          const match = (await suspendedSessions(context.request)).find(
            (session) => session.originalWorkspaceId === originalSessionId && session.status === 'active',
          );
          primarySuspendedId = match?.id ?? '';
          return primarySuspendedId;
        },
        { timeout: 30_000 },
      )
      .not.toBe('');
  });

  await step('retain terminal output produced after the server-owned suspend takeover', async () => {
    await expect
      .poll(
        async () => {
          const response = await context.request.get(`/api/v1/ssh-suspend/log/${primarySuspendedId}`);
          expect(response.ok()).toBeTruthy();
          return response.text();
        },
        { timeout: 10_000 },
      )
      .toContain('AFTER_SUSPEND=');
    const response = await context.request.get(`/api/v1/ssh-suspend/log/${primarySuspendedId}`);
    const text = await response.text();
    expect(text).toContain('folder-seed');
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

  await slowStep('browser reload exposes the existing server-owned suspended session', async () => {
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

    const emptyPanels = page.getByTestId('mobile-empty-workspace-panels');
    const connectionsPanel = page.getByTestId('mobile-empty-connections-panel');
    const suspendedPanel = page.getByTestId('mobile-empty-suspended-panel');
    await expect(emptyPanels).toBeVisible();
    const [connectionsBox, suspendedBox] = await Promise.all([
      connectionsPanel.boundingBox(),
      suspendedPanel.boundingBox(),
    ]);
    expect(connectionsBox).toBeTruthy();
    expect(suspendedBox).toBeTruthy();
    expect(connectionsBox!.height).toBeGreaterThanOrEqual(255);
    expect(suspendedBox!.height).toBeGreaterThanOrEqual(255);
    expect(Math.abs(connectionsBox!.height - suspendedBox!.height)).toBeLessThanOrEqual(1);
    await expect(page.getByTestId('workspace-connection-list').locator('.min-h-0.flex-1.overflow-y-auto')).toHaveCSS(
      'overflow-y',
      'auto',
    );
    const embeddedSuspended = suspendedPanel.getByRole('region', { name: 'Suspended SSH Sessions', exact: true });
    await expect(embeddedSuspended.locator('.session-list-container')).toHaveCSS('overflow-y', 'auto');
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

    const search = manager.locator('.suspended-session-search');
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
    const exportedBeforeResume = Buffer.concat(chunks).toString('utf8');
    expect(exportedBeforeResume).toContain('BEFORE_SUSPEND=');
    expect(exportedBeforeResume).toContain('AFTER_SUSPEND=');

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

    const resumedTab = page
      .getByTestId('terminal-tab-bar')
      .locator('[data-session-id]')
      .filter({ hasText: 'E2E SSH' })
      .first();
    const resumedSessionId = (await resumedTab.getAttribute('data-session-id')) ?? '';
    expect(resumedSessionId).not.toBe('');
    await resumedTab.click({ button: 'right' });
    await expect(page.getByText('Unmark Suspend', { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');

    await resumedTab.getByRole('button', { name: 'Close Tab', exact: true }).click();
    await expect(resumedTab).toHaveCount(0);
    let resuspended: SuspendedSession | undefined;
    await expect
      .poll(
        async () => {
          resuspended = (await suspendedSessions(context.request)).find(
            (session) => session.originalWorkspaceId === resumedSessionId && session.status === 'active',
          );
          return Boolean(resuspended);
        },
        { timeout: 30_000 },
      )
      .toBeTruthy();

    const resumedLog = await context.request.get(`/api/v1/ssh-suspend/log/${resuspended!.id}`);
    expect(resumedLog.ok()).toBeTruthy();
    const resumedLogText = await resumedLog.text();
    expect(resumedLogText).toContain('BEFORE_SUSPEND=');
    expect(resumedLogText).toContain('AFTER_SUSPEND=');
    expect(resumedLogText).toContain('AFTER_RESUME=');
    expect((await context.request.delete(`/api/v1/ssh-suspend/terminate/${resuspended!.id}`)).ok()).toBeTruthy();
  });
});
