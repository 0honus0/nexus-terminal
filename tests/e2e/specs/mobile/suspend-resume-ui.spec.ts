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
  ownershipState: 'available' | 'resuming' | 'attached';
  attachedWorkspaceId?: string;
};

async function suspendedSessions(request: Parameters<typeof loginAsInitialAdmin>[0]): Promise<SuspendedSession[]> {
  const response = await request.get('/api/v1/ssh-suspend/suspended-sessions');
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as SuspendedSession[];
}

async function dragTerminalDown(page: Page): Promise<void> {
  const terminal = page.locator('.terminal-inner-container');
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

test('mobile terminal blocks input until foreground resume completes without replaying keystrokes', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const connectionId = await ensureTestSshConnection(context.request);
  const rejections: Array<{ failureKind?: string; state?: string; inputBytes?: number }> = [];
  page.on('console', (message) => {
    for (const argument of message.args()) {
      void argument
        .jsonValue()
        .then((value) => {
          if (value && typeof value === 'object' && value.failureKind?.startsWith('terminal_input_'))
            rejections.push(value);
        })
        .catch(() => undefined);
    }
  });
  let dropProbe = false;
  let resumes = 0;
  const terminalInputs: string[] = [];
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.routeWebSocket('**/ws/workspace', (socket) => {
    const server = socket.connectToServer();
    socket.onMessage(async (message) => {
      if (typeof message === 'string') {
        const frame = JSON.parse(message);
        if (frame.type === 'terminal.input') terminalInputs.push(frame.payload.data);
        if (frame.type === 'workspace.ping' && dropProbe) return;
        if (frame.type === 'workspace.resume') {
          resumes += 1;
          await barrier;
        }
      }
      server.send(message);
    });
  });
  await connectTestSshFromConnectionsPage(page, connectionId);
  const input = page.locator('.command-bar-command-input');
  await expect(input).toBeEnabled();
  dropProbe = true;
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  try {
    await expect.poll(() => resumes, { timeout: 15_000 }).toBe(1);
    // Preserve the old screen, but do not accept input on an unready attachment.
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.insertText('x');
  } finally {
    dropProbe = false;
    release();
  }
  await expect(input).toBeEnabled();
  await input.fill('printf "%s%s\\n" MOBILE_RECOVERY_ INPUT_OK');
  await input.press('Enter');
  await expect(page.locator('.terminal-inner-container')).toContainText('MOBILE_RECOVERY_INPUT_OK');
  expect(terminalInputs).not.toContain('x');
  expect(rejections).toEqual([]);
});

test('mobile terminal gates automatic status replies during recovery and answers server output replay', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const connectionId = await ensureTestSshConnection(context.request);
  const terminalInputs: string[] = [];
  const rejections: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Terminal input rejected')) rejections.push(message.text());
  });
  let dropProbe = false;
  let resumes = 0;
  let holdQuery = false;
  let delayedQuery: Buffer | undefined;
  let deliverQuery: (() => void) | undefined;
  let replayedQueries = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.routeWebSocket('**/ws/workspace', (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      if (resumes > 0 && typeof message !== 'string' && message.includes(Buffer.from('RECOVERY_QUERY\x1b[5n')))
        replayedQueries++;
      if (holdQuery && typeof message !== 'string' && message.includes(Buffer.from('RECOVERY_QUERY\x1b[5n'))) {
        delayedQuery = message;
        deliverQuery = () => socket.send(message);
        return;
      }
      socket.send(message);
    });
    socket.onMessage(async (message) => {
      if (typeof message === 'string') {
        const frame = JSON.parse(message);
        if (frame.type === 'terminal.input') terminalInputs.push(frame.payload.data);
        if (frame.type === 'workspace.ping' && dropProbe) return;
        if (frame.type === 'workspace.resume') {
          resumes++;
          // The old transport is fenced during reconnect. Deliver the captured
          // real output on the replacement transport, not the obsolete socket.
          deliverQuery = () => {
            if (delayedQuery) socket.send(delayedQuery);
          };
          await barrier;
        }
      }
      server.send(message);
    });
  });
  await connectTestSshFromConnectionsPage(page, connectionId);
  const command = page.locator('.command-bar-command-input');
  const terminal = page.locator('.terminal-inner-container');
  // Consume replies in a remote input loop rather than letting DSR bytes enter
  // the shell's command-editing buffer and corrupt the next probe command.
  await command.fill(
    'printf "STATUS_%s\\n" LOOP_READY; while IFS= read -rsn1 key; do case "$key" in l) printf "LIVE_%s\\033[5n\\n" QUERY;; r) printf "RECOVERY_%s\\033[5n\\n" QUERY;; a) printf "AFTER_%s\\033[5n\\n" QUERY;; q) break;; esac; done; printf "STATUS_%s\\n" LOOP_EXIT',
  );
  await command.press('Enter');
  await expect(terminal).toContainText('STATUS_LOOP_READY');
  const query = async (marker: string) => {
    await command.fill(marker === 'LIVE_QUERY' ? 'l' : marker === 'RECOVERY_QUERY' ? 'r' : 'a');
    await command.press('Enter');
  };
  await query('LIVE_QUERY');
  await expect.poll(() => terminalInputs.filter((data) => data === '\x1b[0n').length).toBe(1);
  holdQuery = true;
  await query('RECOVERY_QUERY');
  await expect.poll(() => Boolean(delayedQuery)).toBe(true);
  dropProbe = true;
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  try {
    await expect.poll(() => resumes, { timeout: 15_000 }).toBe(1);
    await expect(command).toBeDisabled();
    deliverQuery!();
    await expect(terminal).toContainText('RECOVERY_QUERY');
    expect(terminalInputs.filter((data) => data === '\x1b[0n')).toHaveLength(1);
    expect(rejections).toEqual([]);
  } finally {
    holdQuery = false;
    dropProbe = false;
    release();
  }
  await expect(command).toBeEnabled();
  // Resume legitimately replays the server output withheld from the old
  // transport. Its DSR generates a new reply; this is not cached user input.
  await expect.poll(() => replayedQueries).toBe(1);
  await expect.poll(() => terminalInputs.filter((data) => data === '\x1b[0n').length).toBe(2);
  // A fresh query and loop exit provide a final processing boundary.
  await query('AFTER_QUERY');
  await expect.poll(() => terminalInputs.filter((data) => data === '\x1b[0n').length).toBe(3);
  await expect(terminal).toContainText('AFTER_QUERY');
  expect(rejections).toEqual([]);
  await command.fill('q');
  await command.press('Enter');
  await expect(terminal).toContainText('STATUS_LOOP_EXIT');
  expect(terminalInputs.filter((data) => data === '\x1b[0n')).toHaveLength(3);
  expect(replayedQueries).toBe(1);
  expect(rejections).toEqual([]);
});

test('foreground probes preserve healthy SSH and resume a half-open transport without a fresh login', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const connectionId = await ensureTestSshConnection(context.request);
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    const state = { completedProbes: 0 };
    Object.assign(window, { __e2eLiveness: state });
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols ?? []);
        if (new URL(String(url), window.location.href).pathname !== '/ws/workspace') return;
        const probes = new Set<string>();
        const send = this.send.bind(this);
        this.send = (data) => {
          if (typeof data === 'string') {
            const frame = JSON.parse(data);
            if (frame.type === 'workspace.ping') probes.add(frame.requestId);
          }
          send(data);
        };
        this.addEventListener('message', (event) => {
          if (typeof event.data !== 'string') return;
          const frame = JSON.parse(event.data);
          if (frame.type !== 'response' || !frame.payload?.ok || !probes.delete(frame.requestId)) return;
          // Run after dispatch and the promise chain that clears the in-flight probe.
          window.setTimeout(() => state.completedProbes++, 0);
        });
      }
    } as typeof WebSocket;
  });
  let dropProbe = false;
  let connects = 0;
  let resumes = 0;
  let probes = 0;
  await page.routeWebSocket('**/ws/workspace', (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (typeof message === 'string') {
        const frame = JSON.parse(message) as { type?: string };
        if (frame.type === 'workspace.connect') connects += 1;
        if (frame.type === 'workspace.resume') resumes += 1;
        if (frame.type === 'workspace.ping') {
          probes += 1;
          if (dropProbe) return;
        }
      }
      server.send(message);
    });
  });
  await connectTestSshFromConnectionsPage(page, connectionId);
  const tab = page.getByRole('tablist').locator('[data-session-id]').first();
  const workspaceId = await tab.getAttribute('data-session-id');
  const foreground = () => page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  const refreshed = page.waitForResponse(
    (response) => response.url().includes('/ssh-suspend/suspended-sessions') && response.request().method() === 'GET',
  );
  await foreground();
  await expect.poll(() => probes).toBeGreaterThan(0);
  await refreshed;
  await page.waitForFunction((expected) => {
    const state = (window as typeof window & { __e2eLiveness?: { completedProbes: number } }).__e2eLiveness;
    return (state?.completedProbes ?? 0) >= expected;
  }, probes);
  expect(resumes).toBe(0);
  const initialConnects = connects;
  const healthyProbes = probes;
  dropProbe = true;
  await foreground();
  await expect.poll(() => probes).toBeGreaterThan(healthyProbes);
  // Another foreground event while the probe is pending must reuse the recovery.
  await foreground();
  await expect.poll(() => resumes, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(connects).toBe(initialConnects);
  await expect(tab).toHaveAttribute('data-session-id', workspaceId!);
  const input = page.locator('.command-bar-command-input');
  await input.fill('echo FOREGROUND_RECOVERY_OK');
  await input.press('Enter');
  await expect(page.locator('.terminal-inner-container')).toContainText('FOREGROUND_RECOVERY_OK');
  expect(resumes).toBe(1);
  dropProbe = false;
  await page.locator('.app-nav-links a[href="/settings"]').click();
  await expect(page).toHaveURL(/\/settings$/);
  dropProbe = true;
  await page.locator('.app-nav-links a[href="/workspace"]').click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect.poll(() => resumes, { timeout: 15_000 }).toBe(2);
  await expect(input).toBeEnabled();
  expect(connects).toBe(initialConnects);
});

test('mobile suspended catalog refreshes promptly after the immediate suspend handoff', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  const tab = page.getByRole('tablist').locator('[data-session-id]').filter({ hasText: 'E2E SSH' }).first();
  await expect(tab).toBeVisible();
  const originalWorkspaceId = (await tab.getAttribute('data-session-id')) ?? '';
  expect(originalWorkspaceId).not.toBe('');

  // Prime the shared catalog while it is still empty. Reopening/mounting a suspended-session
  // view after the handoff must not trust this cached result.
  await page.getByRole('tablist').getByRole('button', { name: 'Suspended SSH Sessions', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Suspended SSH Sessions', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Suspended SSH Sessions', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();

  let suspendedId = '';
  try {
    await tab.click({ button: 'right' });
    await page.getByText('Suspend Session', { exact: true }).click();
    await expect(tab).toHaveCount(1);
    await tab.getByRole('button', { name: 'Close Tab', exact: true }).click();
    await expect(tab).toHaveCount(0);

    const emptySuspendedPanel = page.locator('.workspace-start-page');
    await expect(emptySuspendedPanel).toBeVisible();
    const handedOffRow = emptySuspendedPanel.locator('[data-suspend-id]').filter({ hasText: 'E2E SSH' }).first();
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

test('cached suspended cards remain visible while a remounted panel refreshes its catalog', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  const original = await openWorkspaceSession(context.request, connectionId, `stable-catalog-${crypto.randomUUID()}`);
  await requestWorkspace(original.socket, 'suspend.mark', { terminalSnapshot: 'STABLE_CATALOG_SNAPSHOT\r\n' });
  await closeWebSocket(original.socket);
  let suspended: SuspendedSession | undefined;
  await expect
    .poll(async () => {
      suspended = (await suspendedSessions(context.request)).find(
        (session) => session.originalWorkspaceId === original.workspaceId && session.status === 'active',
      );
      return Boolean(suspended);
    })
    .toBeTruthy();
  await page.goto('/workspace');
  const card = page.locator(`[data-suspend-id="${suspended!.id}"]`);
  await expect(card).toBeVisible();
  await page.locator('.app-nav-links a[href="/settings"]').click();
  await expect(page).toHaveURL(/\/settings$/);
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  let refreshes = 0;
  await page.route('**/api/v1/ssh-suspend/suspended-sessions', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    refreshes += 1;
    await barrier;
    await route.continue();
  });
  try {
    await page.locator('.app-nav-links a[href="/workspace"]').click();
    await expect.poll(() => refreshes).toBeGreaterThan(0);
    await expect(card).toBeVisible();
    await expect(page.locator('.suspended-session-loading')).toHaveCount(0);
  } finally {
    release();
  }
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByText(/resumed successfully\.$/)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.command-bar-command-input')).toBeEnabled();
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

  let historyRequests = 0;
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/ws/workspace') return;
    socket.on('framesent', (event) => {
      if (typeof event.payload !== 'string') return;
      try {
        if ((JSON.parse(event.payload) as { type?: string }).type === 'suspend.history.previous') historyRequests += 1;
      } catch {
        return;
      }
    });
  });

  await page.goto('/workspace');
  const manager = page.getByRole('region', { name: 'Suspended SSH Sessions', exact: true });
  const hanging = manager.locator(`[data-suspend-id="${suspended!.id}"]`);
  await expect(hanging).toBeVisible({ timeout: 20_000 });
  await hanging.getByRole('button', { name: 'Resume', exact: true }).click();
  // The cached binary tail can render before suspend.resume has returned. Wait for the
  // UI-level completion signal so previous-history availability is installed before the
  // synthetic swipe starts; real touch gestures naturally happen after this point.
  await expect(page.getByText(/resumed successfully\.$/)).toBeVisible({ timeout: 20_000 });

  const terminal = page.locator('.terminal-inner-container');
  const rows = terminal.locator('.xterm-rows');
  await expect(terminal).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => rows.innerText(), { timeout: 20_000 }).toContain(tailMarker);
  await expect(rows).not.toContainText(earlyMarker);
  expect(historyRequests).toBe(0);

  // Native touch scrolling moves terminal content with the finger, so dragging downward navigates
  // toward older output. The first gesture can land on the currently loaded history boundary while
  // the previous page is fetched. Prepending intentionally preserves that viewport anchor, so a
  // following downward gesture is what navigates into the newly inserted rows.
  for (let attempt = 0; attempt < 6 && historyRequests === 0; attempt += 1) {
    await dragTerminalDown(page);
    await page.waitForTimeout(250);
  }
  expect(historyRequests).toBeGreaterThan(0);
  await expect(rows).not.toContainText(earlyMarker);

  for (let attempt = 0; attempt < 30 && !(await rows.innerText()).includes(earlyMarker); attempt += 1) {
    await dragTerminalDown(page);
    await page.waitForTimeout(250);
  }
  await expect.poll(async () => rows.innerText(), { timeout: 20_000 }).toContain(earlyMarker);

  const resumedTab = page.getByRole('tablist').locator('[data-session-id]').filter({ hasText: 'E2E SSH' }).first();
  await resumedTab.click({ button: 'right' });
  await expect(page.getByText('Unmark Suspend', { exact: true })).toBeVisible({ timeout: 10_000 });
  const catalogRefresh = page.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url().includes('/ssh-suspend/suspended-sessions'),
  );
  await page.getByText('Unmark Suspend', { exact: true }).click();
  await catalogRefresh;
  await resumedTab.click({ button: 'right' });
  await expect(page.getByText('Suspend Session', { exact: true })).toBeVisible();
});

test('mobile resume replaces an immediately suspended tab without exposing a temporary duplicate', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    const tracked: WebSocket[] = [];
    const target = window as typeof window & { __e2eWorkspaceSockets?: WebSocket[] };
    target.__e2eWorkspaceSockets = tracked;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols ?? []);
        if (new URL(String(url), window.location.href).pathname === '/ws/workspace') tracked.push(this);
      }
    } as typeof WebSocket;
  });
  await connectTestSshFromConnectionsPage(page, connectionId);

  const tabBar = page.getByRole('tablist');
  const tab = tabBar.locator('[data-session-id]').filter({ hasText: 'E2E SSH' }).first();
  await expect(tab).toBeVisible({ timeout: 20_000 });
  const originalSessionId = (await tab.getAttribute('data-session-id')) ?? '';
  expect(originalSessionId).not.toBe('');

  await page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('[role="tablist"]');
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
    await expect(tab).toHaveCount(1);
    await tab.getByRole('button', { name: 'Close Tab', exact: true }).click();
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

    const manager = page.locator('.workspace-start-page');
    await expect(manager).toBeVisible();
    const hanging = manager.locator(`[data-suspend-id="${suspended!.id}"]`);
    await expect(hanging).toBeVisible({ timeout: 20_000 });
    await hanging.getByRole('button', { name: 'Resume', exact: true }).click();

    await expect.poll(() => tabBar.locator('[data-session-id]').count(), { timeout: 30_000 }).toBe(1);
    const resumedSessionId =
      (await tabBar
        .locator('[data-session-id]')
        .filter({ hasText: 'E2E SSH' })
        .first()
        .getAttribute('data-session-id')) ?? '';
    expect(resumedSessionId).not.toBe('');
    await expect
      .poll(
        async () => {
          const record = (await suspendedSessions(context.request)).find((session) => session.id === suspended!.id);
          return record
            ? {
                status: record.status,
                ownershipState: record.ownershipState,
                attachedWorkspaceId: record.attachedWorkspaceId,
              }
            : null;
        },
        { timeout: 30_000 },
      )
      .toEqual({
        status: 'active',
        ownershipState: 'attached',
        attachedWorkspaceId: resumedSessionId,
      });

    const maxTabs = await page.evaluate(() => {
      return (window as typeof window & { __suspendTabState?: { maxTabs: number } }).__suspendTabState?.maxTabs ?? 0;
    });
    expect(maxTabs).toBe(1);
    await expect(tabBar.locator('[data-session-id]').filter({ hasText: 'E2E SSH' }).first()).toBeVisible();

    await tabBar.getByRole('button', { name: 'New Connection Tab', exact: true }).click();
    await expect(page.locator('.workspace-start-page')).toBeVisible();
    const browserSocketClosed = await page.evaluate(() => {
      const sockets = (window as typeof window & { __e2eWorkspaceSockets?: WebSocket[] }).__e2eWorkspaceSockets ?? [];
      const socket = [...sockets].reverse().find((candidate) => candidate.readyState === WebSocket.OPEN);
      if (!socket) return false;
      socket.close(4000, 'E2E controlled Workspace disconnect');
      return true;
    });
    expect(browserSocketClosed).toBeTruthy();
    await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));

    await expect
      .poll(
        async () => {
          const currentTab = tabBar.locator('[data-session-id]').filter({ hasText: 'E2E SSH' }).first();
          const workspaceId = (await currentTab.getAttribute('data-session-id')) ?? '';
          const record = (await suspendedSessions(context.request)).find((session) => session.id === suspended!.id);
          return {
            tabCount: await tabBar.locator('[data-session-id]').count(),
            workspaceId,
            originalWorkspaceId: record?.originalWorkspaceId,
            status: record?.status,
            ownershipState: record?.ownershipState,
            attachedWorkspaceId: record?.attachedWorkspaceId,
          };
        },
        { timeout: 30_000 },
      )
      .toMatchObject({
        tabCount: 1,
        originalWorkspaceId: resumedSessionId,
        status: 'active',
        ownershipState: 'attached',
      });

    const recoveredTab = tabBar.locator('[data-session-id]').filter({ hasText: 'E2E SSH' }).first();
    const recoveredSessionId = (await recoveredTab.getAttribute('data-session-id')) ?? '';
    expect(recoveredSessionId).not.toBe('');
    expect(recoveredSessionId).not.toBe(resumedSessionId);
    await expect(page.locator('.workspace-start-page')).toBeVisible();
    await expect
      .poll(async () => {
        const record = (await suspendedSessions(context.request)).find((session) => session.id === suspended!.id);
        return record?.attachedWorkspaceId;
      })
      .toBe(recoveredSessionId);

    await recoveredTab.click();
    await page.getByRole('tablist').getByRole('button', { name: 'Suspended SSH Sessions', exact: true }).click();
    const recoveredManager = page.getByRole('dialog', { name: 'Suspended SSH Sessions', exact: true });
    await expect(recoveredManager).toBeVisible();
    await expect(recoveredManager.locator(`[data-suspend-id="${suspended!.id}"]`)).toBeVisible({ timeout: 20_000 });
    await expect(recoveredManager.locator('.session-card').filter({ hasText: 'E2E SSH' })).toHaveCount(1);
    await recoveredManager.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(recoveredManager).toBeHidden();

    const recoveredInput = page.locator('.command-bar-command-input');
    await expect(recoveredInput).toBeEnabled({ timeout: 20_000 });
    await recoveredInput.fill("printf 'AUTO_RECONCILE_OK\\n'");
    await recoveredInput.press('Enter');
    await expect
      .poll(async () => page.locator('.terminal-inner-container .xterm-rows').innerText())
      .toContain('AUTO_RECONCILE_OK');
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

  const terminal = page.locator('.terminal-inner-container');
  const rows = terminal.locator('.xterm-rows');
  const terminalText = async () => (await rows.locator(':scope > div').allTextContents()).join('');
  const commandInput = page.locator('.command-bar-command-input');
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
    const tab = page.getByRole('tablist').locator('[data-session-id]').filter({ hasText: 'E2E SSH' }).first();
    await expect(tab).toBeVisible();
    originalSessionId = (await tab.getAttribute('data-session-id')) ?? '';
    expect(originalSessionId).not.toBe('');

    await commandInput.fill('(sleep 0.5; printf \'AFTER_SUSPEND=%s\\n\' "$PWD") &');
    await commandInput.press('Enter');
    await tab.click({ button: 'right' });
    await page.getByText('Suspend Session', { exact: true }).click();
    await expect(tab).toHaveCount(1);
    await tab.getByRole('button', { name: 'Close Tab', exact: true }).click();
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

    const emptyPanels = page.locator('.workspace-start-page');
    const connectionsPanel = emptyPanels.locator('.workspace-connection-list');
    const suspendedPanel = emptyPanels.getByRole('region', { name: 'Suspended SSH Sessions', exact: true });
    await expect(emptyPanels).toBeVisible();
    const [connectionsBox, suspendedBox] = await Promise.all([
      connectionsPanel.boundingBox(),
      suspendedPanel.boundingBox(),
    ]);
    expect(connectionsBox).toBeTruthy();
    expect(suspendedBox).toBeTruthy();
    expect(connectionsBox!.y).toBeLessThan(suspendedBox!.y);
    await expect(emptyPanels).toHaveCSS('overflow-y', 'auto');
    await expect(connectionsPanel.locator('.workspace-connection-content')).toHaveCSS('overflow-y', 'visible');
    await expect(suspendedPanel.locator('.session-list-container')).toHaveCSS('overflow-y', 'visible');
  });

  await slowStep('Suspended Sessions UI resumes the hanging shell instead of opening a new SSH shell', async () => {
    const manager = page.getByRole('region', { name: 'Suspended SSH Sessions', exact: true });
    await expect(manager).toBeVisible();
    const catalog = await suspendedSessions(context.request);
    const primary = catalog.find((session) => session.originalWorkspaceId === originalSessionId);
    const disposable = catalog.find((session) => session.originalWorkspaceId === disposableOriginalSessionId);
    expect(primary).toBeTruthy();
    expect(disposable).toBeTruthy();
    const hanging = manager.locator(`[data-suspend-id="${primary!.id}"]`);
    const disposableRow = manager.locator(`[data-suspend-id="${disposable!.id}"]`);
    await expect(hanging).toBeVisible({ timeout: 20_000 });
    await expect(disposableRow).toBeVisible({ timeout: 20_000 });
    await expect(manager.locator('i.fa-search')).toBeVisible();
    await expect(hanging.locator('i.fa-play')).toBeVisible();
    await expect(hanging.locator('i.fa-trash-alt')).toBeVisible();
    await expect(hanging.locator('i.fa-download')).toBeVisible();

    const search = manager.locator('.suspended-session-search input');
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

    const resumedTab = page.getByRole('tablist').locator('[data-session-id]').filter({ hasText: 'E2E SSH' }).first();
    await expect(resumedTab).toBeVisible({ timeout: 30_000 });
    await expect(terminal).toBeVisible({ timeout: 30_000 });

    // A replacement terminal tab is mounted before the resume transaction is
    // fully committed. Wait for the server-owned suspended record to bind to
    // that replacement Workspace before sending the next command.
    const resumedSessionId = (await resumedTab.getAttribute('data-session-id')) ?? '';
    expect(resumedSessionId).not.toBe('');
    await expect
      .poll(
        async () => {
          const record = (await suspendedSessions(context.request)).find((session) => session.id === primary!.id);
          return record
            ? {
                status: record.status,
                ownershipState: record.ownershipState,
                attachedWorkspaceId: record.attachedWorkspaceId,
              }
            : null;
        },
        { timeout: 30_000 },
      )
      .toEqual({
        status: 'active',
        ownershipState: 'attached',
        attachedWorkspaceId: resumedSessionId,
      });

    const resumedInput = page.locator('.command-bar-command-input');
    await resumedInput.fill('printf \'AFTER_RESUME=%s\\n\' "$PWD"');
    await resumedInput.press('Enter');
    await expect.poll(async () => rows.innerText(), { timeout: 20_000 }).toContain('AFTER_RESUME=');
    await expect.poll(async () => rows.innerText(), { timeout: 20_000 }).toContain('folder-seed');

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
