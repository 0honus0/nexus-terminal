import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  E2E_SSH,
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
} from '../../support/ssh';
import {
  closeWebSocket,
  openAuthenticatedWebSocket,
  openWorkspaceSession,
  requestWorkspace,
  sendJson,
  waitForBinaryText,
  waitForFilesystemReady,
} from '../../support/ws';

test('stale suspended-session resume logs structured not-found diagnostics', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  const settingsResponse = await context.request.get('/api/v1/settings');
  expect(settingsResponse.ok()).toBeTruthy();
  const originalFrontendLogLevel =
    ((await settingsResponse.json()) as { frontendLogLevel?: string }).frontendLogLevel ?? 'info';
  expect(
    (
      await context.request.put('/api/v1/settings', {
        data: { frontendLogLevel: 'debug' },
      })
    ).ok(),
  ).toBeTruthy();

  const original = await openWorkspaceSession(context.request, connectionId, `stale-resume-${crypto.randomUUID()}`);
  await requestWorkspace(original.socket, 'suspend.mark');
  await closeWebSocket(original.socket);

  type SuspendedSession = { id: string; originalWorkspaceId: string; status: 'active' | 'disconnected' };
  let suspended: SuspendedSession | undefined;
  const catalogSocket = await openAuthenticatedWebSocket(context.request);
  try {
    for (let attempt = 0; attempt < 30 && !suspended; attempt += 1) {
      const list = await requestWorkspace<SuspendedSession[]>(catalogSocket, 'suspend.list');
      suspended = list.find(
        (session) => session.originalWorkspaceId === original.workspaceId && session.status === 'active',
      );
      if (!suspended) await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    await closeWebSocket(catalogSocket);
  }
  expect(suspended).toBeTruthy();

  const frontendDebugLogs: Array<Record<string, unknown>> = [];
  page.on('console', (message) => {
    if (message.type() !== 'debug' && message.type() !== 'log') return;
    for (const argument of message.args()) {
      void argument
        .jsonValue()
        .then((value) => {
          if (value && typeof value === 'object' && typeof (value as { msg?: unknown }).msg === 'string') {
            frontendDebugLogs.push(value as Record<string, unknown>);
          }
        })
        .catch(() => undefined);
    }
  });

  try {
    await page.goto('/workspace?openSuspended=1');
    const modal = page.getByTestId('suspended-sessions-modal');
    await expect(modal).toBeVisible({ timeout: 20_000 });
    const row = modal.getByTestId(`suspended-session-${suspended!.id}`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    const resumeButton = row.getByRole('button', { name: 'Resume', exact: true });
    await expect(resumeButton).toBeVisible();

    const terminate = await context.request.delete(`/api/v1/ssh-suspend/terminate/${suspended!.id}`);
    expect(terminate.ok(), await terminate.text()).toBeTruthy();
    await resumeButton.click();

    await expect
      .poll(() =>
        frontendDebugLogs.some(
          (entry) =>
            entry.msg === 'Workspace request rejected' &&
            entry.operation === 'suspend.resume' &&
            entry.failureKind === 'session_not_found_or_invalid' &&
            entry.connectionId === connectionId,
        ),
      )
      .toBeTruthy();
    await expect
      .poll(() =>
        frontendDebugLogs.some(
          (entry) =>
            entry.msg === 'Workspace suspended-session resume failed in view' &&
            entry.suspendedSessionId === suspended!.id &&
            entry.connectionId === connectionId,
        ),
      )
      .toBeTruthy();
    expect(JSON.stringify(frontendDebugLogs)).not.toContain(E2E_SSH.password);
  } finally {
    if (suspended) await context.request.delete(`/api/v1/ssh-suspend/terminate/${suspended.id}`).catch(() => undefined);
    const restoreSettings = await context.request.put('/api/v1/settings', {
      data: { frontendLogLevel: originalFrontendLogLevel },
    });
    expect(restoreSettings.ok()).toBeTruthy();
  }
});

test('a marked live SSH session survives WebSocket disconnect and resumes the same shell', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const original = await openWorkspaceSession(request, connectionId, `suspend-${crypto.randomUUID()}`);

  await requestWorkspace(original.socket, 'suspend.mark');
  await closeWebSocket(original.socket);

  const recoverySocket = await openAuthenticatedWebSocket(request);
  try {
    type SuspendedSession = {
      id: string;
      originalWorkspaceId: string;
      connectionId: number;
      connectionName: string;
      status: 'active' | 'disconnected';
    };
    let suspended: SuspendedSession | undefined;
    for (let attempt = 0; attempt < 30 && !suspended; attempt += 1) {
      const list = await requestWorkspace<SuspendedSession[]>(recoverySocket, 'suspend.list');
      suspended = list.find(
        (session) => session.originalWorkspaceId === original.workspaceId && session.status === 'active',
      );
      if (!suspended) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    expect(suspended).toBeTruthy();
    expect(suspended).toMatchObject({
      originalWorkspaceId: original.workspaceId,
      connectionId,
      status: 'active',
    });

    const resumedWorkspaceId = `resumed-${crypto.randomUUID()}`;
    const resumed = await requestWorkspace<{
      workspaceId: string;
      connectionId: number;
      connectionName: string;
      resumedFrom: string;
    }>(recoverySocket, 'suspend.resume', {
      suspendedSessionId: suspended!.id,
      workspaceId: resumedWorkspaceId,
    });
    expect(resumed).toMatchObject({
      workspaceId: resumedWorkspaceId,
      connectionId,
      resumedFrom: suspended!.id,
    });
    await waitForFilesystemReady(recoverySocket);

    const listAfter = await requestWorkspace<SuspendedSession[]>(recoverySocket, 'suspend.list');
    expect(listAfter.some((session) => session.id === suspended!.id)).toBeFalsy();

    // Resume does not cancel the suspend mark. Closing the restored Workspace must hand
    // the same live shell back to the suspend service under the replacement workspace id.
    await closeWebSocket(recoverySocket);
    const verifier = await openAuthenticatedWebSocket(request);
    try {
      let resuspended: SuspendedSession | undefined;
      for (let attempt = 0; attempt < 30 && !resuspended; attempt += 1) {
        const list = await requestWorkspace<SuspendedSession[]>(verifier, 'suspend.list');
        resuspended = list.find(
          (session) => session.originalWorkspaceId === resumedWorkspaceId && session.status === 'active',
        );
        if (!resuspended) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(resuspended).toBeTruthy();
      await requestWorkspace(verifier, 'suspend.terminate', { suspendedSessionId: resuspended!.id });
    } finally {
      await closeWebSocket(verifier);
    }
  } finally {
    await closeWebSocket(recoverySocket);
  }
});

test('closing a resume request rolls the handoff back to the original suspended shell', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const original = await openWorkspaceSession(request, connectionId, `resume-rollback-${crypto.randomUUID()}`);
  await requestWorkspace(original.socket, 'suspend.mark', { terminalSnapshot: 'ROLLBACK_HISTORY\r\n' });
  await closeWebSocket(original.socket);

  type SuspendedSession = {
    id: string;
    originalWorkspaceId: string;
    status: 'active' | 'disconnected';
  };
  const recoverySocket = await openAuthenticatedWebSocket(request);
  let suspended: SuspendedSession | undefined;
  for (let attempt = 0; attempt < 30 && !suspended; attempt += 1) {
    const list = await requestWorkspace<SuspendedSession[]>(recoverySocket, 'suspend.list');
    suspended = list.find(
      (session) => session.originalWorkspaceId === original.workspaceId && session.status === 'active',
    );
    if (!suspended) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(suspended).toBeTruthy();

  const interruptedWorkspaceId = `interrupted-resume-${crypto.randomUUID()}`;
  sendJson(recoverySocket, {
    type: 'suspend.resume',
    requestId: crypto.randomUUID(),
    payload: {
      suspendedSessionId: suspended!.id,
      workspaceId: interruptedWorkspaceId,
    },
  });
  recoverySocket.close();
  await new Promise<void>((resolve) => {
    if (recoverySocket.readyState >= 3) return resolve();
    const timeout = setTimeout(resolve, 2_000);
    recoverySocket.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  const verifier = await openAuthenticatedWebSocket(request);
  try {
    let recoverable: SuspendedSession | undefined;
    for (let attempt = 0; attempt < 40 && !recoverable; attempt += 1) {
      const list = await requestWorkspace<SuspendedSession[]>(verifier, 'suspend.list');
      // If close wins before commit, rollback preserves the original suspended id. If commit wins
      // first, the still-marked replacement is immediately suspended on socket close. Either way
      // the same shell must remain recoverable instead of being terminated.
      recoverable = list.find(
        (session) =>
          session.status === 'active' &&
          (session.id === suspended!.id || session.originalWorkspaceId === interruptedWorkspaceId),
      );
      if (!recoverable) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(recoverable).toBeTruthy();

    const retryWorkspaceId = `resume-retry-${crypto.randomUUID()}`;
    const retried = await requestWorkspace<{ workspaceId: string; resumedFrom: string }>(verifier, 'suspend.resume', {
      suspendedSessionId: recoverable!.id,
      workspaceId: retryWorkspaceId,
    });
    expect(retried).toMatchObject({ workspaceId: retryWorkspaceId, resumedFrom: recoverable!.id });
    await requestWorkspace(verifier, 'suspend.unmark');
  } finally {
    await closeWebSocket(verifier);
  }
});

test('terminal output produced after marking is retained in suspended history', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId, `marked-history-${crypto.randomUUID()}`);
  const before = 'MARK_HISTORY_BEFORE';
  const after = 'MARK_HISTORY_AFTER';

  await requestWorkspace(workspace.socket, 'suspend.mark', { terminalSnapshot: `${before}\r\n` });
  const output = waitForBinaryText(workspace.socket, after);
  await requestWorkspace(workspace.socket, 'terminal.input', { data: `printf '${after}\\n'\r` });
  await output;
  await closeWebSocket(workspace.socket);

  const verifier = await openAuthenticatedWebSocket(request);
  try {
    type SuspendedSession = { id: string; originalWorkspaceId: string; status: 'active' | 'disconnected' };
    let suspended: SuspendedSession | undefined;
    for (let attempt = 0; attempt < 30 && !suspended; attempt += 1) {
      const list = await requestWorkspace<SuspendedSession[]>(verifier, 'suspend.list');
      suspended = list.find(
        (session) => session.originalWorkspaceId === workspace.workspaceId && session.status === 'active',
      );
      if (!suspended) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(suspended).toBeTruthy();
    const exported = await request.get(`/api/v1/ssh-suspend/log/${suspended!.id}`);
    expect(exported.ok()).toBeTruthy();
    const text = await exported.text();
    expect(text).toContain(before);
    expect(text).toContain(after);
    expect((await request.delete(`/api/v1/ssh-suspend/terminate/${suspended!.id}`)).ok()).toBeTruthy();
  } finally {
    await closeWebSocket(verifier);
  }
});

test('resume sends only the newest cached tail and pages older terminal history on demand', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const original = await openWorkspaceSession(request, connectionId, `suspend-history-${crypto.randomUUID()}`);

  const earlyMarker = 'SUSPEND_HISTORY_EARLIEST';
  const tailMarker = 'SUSPEND_HISTORY_LATEST';
  const filler = Array.from(
    { length: 5200 },
    (_, index) => `history-${String(index).padStart(5, '0')}-${'x'.repeat(112)}`,
  );
  const snapshot = `${earlyMarker}\r\n${filler.join('\r\n')}\r\n${tailMarker}\r\n`;
  expect(Buffer.byteLength(snapshot)).toBeGreaterThan(512 * 1024);
  expect(Buffer.byteLength(snapshot)).toBeLessThan(900 * 1024);

  await requestWorkspace(original.socket, 'suspend.mark', { terminalSnapshot: snapshot });
  await closeWebSocket(original.socket);

  const recoverySocket = await openAuthenticatedWebSocket(request);
  try {
    type SuspendedSession = {
      id: string;
      originalWorkspaceId: string;
      status: 'active' | 'disconnected';
    };
    let suspended: SuspendedSession | undefined;
    for (let attempt = 0; attempt < 30 && !suspended; attempt += 1) {
      const list = await requestWorkspace<SuspendedSession[]>(recoverySocket, 'suspend.list');
      suspended = list.find(
        (session) => session.originalWorkspaceId === original.workspaceId && session.status === 'active',
      );
      if (!suspended) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(suspended).toBeTruthy();

    const initialChunks: Buffer[] = [];
    const onInitialMessage = (data: Buffer, isBinary: boolean) => {
      if (isBinary) initialChunks.push(Buffer.from(data));
    };
    recoverySocket.on('message', onInitialMessage);
    const resumedWorkspaceId = `resumed-history-${crypto.randomUUID()}`;
    const startedAt = Date.now();
    const resumed = await requestWorkspace<{
      workspaceId: string;
      resumedFrom: string;
      historyAvailable: boolean;
    }>(
      recoverySocket,
      'suspend.resume',
      { suspendedSessionId: suspended!.id, workspaceId: resumedWorkspaceId },
      crypto.randomUUID(),
      5_000,
    );
    recoverySocket.off('message', onInitialMessage);

    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(resumed).toMatchObject({
      workspaceId: resumedWorkspaceId,
      resumedFrom: suspended!.id,
      historyAvailable: true,
    });
    const initialOutput = Buffer.concat(initialChunks).toString('utf8');
    const cachedTailEnd = initialOutput.indexOf(`${tailMarker}\r\n`);
    expect(cachedTailEnd).toBeGreaterThanOrEqual(0);
    const cachedTail = initialOutput.slice(0, cachedTailEnd + tailMarker.length + 2);
    // commitResume resumes the live PTY before the JSON response is observed, so a prompt can
    // legitimately follow the bounded cached tail in the same binary capture window. Bound and
    // reconstruct only the cached portion through the known terminal-snapshot tail marker.
    expect(Buffer.byteLength(cachedTail)).toBeLessThanOrEqual(256 * 1024);
    expect(cachedTail).toContain(tailMarker);
    expect(cachedTail).not.toContain(earlyMarker);
    // The cached tail must be a literal suffix of the retained snapshot. Live PTY output belongs
    // after this stream; if a prompt races the resume handoff it must not prefix the tail boundary.
    expect(snapshot.endsWith(cachedTail)).toBe(true);

    let older = '';
    let firstPreviousPage: { dataBase64: string; hasMore: boolean } | null = null;
    let hasMore = resumed.historyAvailable;
    let pages = 0;
    while (hasMore && pages < 10) {
      const page = await requestWorkspace<{ dataBase64: string; hasMore: boolean }>(
        recoverySocket,
        'suspend.history.previous',
      );
      firstPreviousPage ??= page;
      const text = Buffer.from(page.dataBase64, 'base64').toString('utf8');
      older = text + older;
      hasMore = page.hasMore;
      pages += 1;
    }
    expect(hasMore).toBe(false);
    expect(pages).toBeGreaterThan(0);
    expect(`${older}${cachedTail}`).toBe(snapshot);

    const reset = await requestWorkspace<{ available: boolean }>(recoverySocket, 'suspend.history.reset');
    expect(reset.available).toBe(true);
    const replayedFirstPage = await requestWorkspace<{ dataBase64: string; hasMore: boolean }>(
      recoverySocket,
      'suspend.history.previous',
    );
    expect(replayedFirstPage).toEqual(firstPreviousPage);
    await requestWorkspace(recoverySocket, 'suspend.unmark');
  } finally {
    await closeWebSocket(recoverySocket);
  }
});

test('resumed terminal pages older history through a bounded window and restores the live tail', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);

  const suspendedWorkspace = await openWorkspaceSession(
    context.request,
    connectionId,
    `suspend-ui-history-${crypto.randomUUID()}`,
  );
  const earlyMarker = 'LAZY_HISTORY_EARLIEST';
  const tailMarker = 'LAZY_HISTORY_LATEST';
  const filler = Array.from(
    { length: 4500 },
    (_, index) => `ui-history-${String(index).padStart(5, '0')}-${'x'.repeat(44)}`,
  );
  const snapshot = `${earlyMarker}\r\n${filler.join('\r\n')}\r\n${tailMarker}\r\n`;
  expect(Buffer.byteLength(snapshot)).toBeGreaterThan(256 * 1024);
  expect(Buffer.byteLength(snapshot)).toBeLessThan(512 * 1024);

  await requestWorkspace(suspendedWorkspace.socket, 'suspend.mark', { terminalSnapshot: snapshot });
  await closeWebSocket(suspendedWorkspace.socket);

  type SuspendedSession = {
    id: string;
    originalWorkspaceId: string;
    status: 'active' | 'disconnected';
  };
  let suspended: SuspendedSession | undefined;
  const catalogSocket = await openAuthenticatedWebSocket(context.request);
  try {
    for (let attempt = 0; attempt < 30 && !suspended; attempt += 1) {
      const list = await requestWorkspace<SuspendedSession[]>(catalogSocket, 'suspend.list');
      suspended = list.find(
        (session) => session.originalWorkspaceId === suspendedWorkspace.workspaceId && session.status === 'active',
      );
      if (!suspended) await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    await closeWebSocket(catalogSocket);
  }
  expect(suspended).toBeTruthy();

  type E2eLayoutNode = {
    id?: string;
    type: 'pane' | 'container';
    component?: string;
    direction?: 'horizontal' | 'vertical';
    size?: number;
    children?: E2eLayoutNode[];
  };
  const layoutResponse = await context.request.get('/api/v1/settings/layout');
  expect(layoutResponse.ok()).toBeTruthy();
  const originalLayout = (await layoutResponse.json()) as E2eLayoutNode;
  const suspendedLayout = structuredClone(originalLayout);
  const replaceEditorWithSuspended = (node: E2eLayoutNode): boolean => {
    if (node.type === 'pane' && node.component === 'editor') {
      node.component = 'suspendedSshSessions';
      return true;
    }
    return node.children?.some(replaceEditorWithSuspended) ?? false;
  };
  expect(replaceEditorWithSuspended(suspendedLayout)).toBe(true);
  expect((await context.request.put('/api/v1/settings/layout', { data: suspendedLayout })).ok()).toBeTruthy();

  try {
    await connectTestSshFromConnectionsPage(page, connectionId);
    const suspendedPanel = page.getByTestId('suspended-sessions-view').filter({ visible: true }).first();
    await expect(suspendedPanel).toBeVisible({ timeout: 20_000 });
    const suspendedRow = suspendedPanel.getByTestId(`suspended-session-${suspended!.id}`);
    await expect(suspendedRow).toBeVisible({ timeout: 20_000 });
    let historyRequestCount = 0;
    let historyResponseCount = 0;
    const historyRequestIds = new Set<string>();
    page.on('websocket', (socket) => {
      socket.on('framesent', ({ payload }) => {
        if (typeof payload !== 'string') return;
        try {
          const message = JSON.parse(payload) as { type?: string; requestId?: string };
          if (message.type === 'suspend.history.previous') {
            historyRequestCount += 1;
            if (message.requestId) historyRequestIds.add(message.requestId);
          }
        } catch {
          // Ignore binary/non-protocol frames from other sockets on the page.
        }
      });
      socket.on('framereceived', ({ payload }) => {
        if (typeof payload !== 'string') return;
        try {
          const message = JSON.parse(payload) as { type?: string; requestId?: string };
          if (message.type === 'response' && message.requestId && historyRequestIds.delete(message.requestId)) {
            historyResponseCount += 1;
          }
        } catch {
          // Ignore binary/non-protocol frames from other sockets on the page.
        }
      });
    });
    await suspendedRow.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(page.getByText(/resumed successfully\.$/)).toBeVisible({ timeout: 20_000 });

    const terminals = page.locator('[data-testid="terminal"]:visible');
    await expect(terminals).toHaveCount(1, { timeout: 20_000 });
    const terminal = terminals.first();
    const rows = terminal.locator('.xterm-rows');
    await expect
      .poll(async () => (await rows.locator(':scope > div').allTextContents()).join(''))
      .toContain(tailMarker);
    await expect(rows).not.toContainText(earlyMarker);

    // xterm 6 uses a custom scrollable element; the legacy .xterm-viewport no longer exposes
    // the terminal's actual scrollTop/scrollHeight. Assert lazy paging at the protocol boundary
    // instead of reading obsolete DOM scroll metrics.
    await page.waitForTimeout(350);
    expect(historyRequestCount).toBe(0);

    const scrollable = terminal.locator('.xterm-scrollable-element').first();
    const scrollableBox = await scrollable.boundingBox();
    expect(scrollableBox).toBeTruthy();
    await page.mouse.move(scrollableBox!.x + scrollableBox!.width - 2, scrollableBox!.y + scrollableBox!.height / 2);
    const scrollbar = scrollable.locator(':scope > .scrollbar.vertical').first();
    await expect(scrollbar).toHaveClass(/visible/);
    const slider = scrollbar.locator(':scope > .slider');
    await expect(slider).toBeVisible();
    const dragHistorySliderToTop = async () => {
      const scrollbarBox = await scrollbar.boundingBox();
      const sliderBox = await slider.boundingBox();
      expect(scrollbarBox).toBeTruthy();
      expect(sliderBox).toBeTruthy();
      const x = sliderBox!.x + sliderBox!.width / 2;
      await page.mouse.move(x, sliderBox!.y + sliderBox!.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, scrollbarBox!.y + 2, { steps: 8 });
      await page.mouse.up();
    };
    const dragHistorySliderToBottom = async () => {
      const scrollbarBox = await scrollbar.boundingBox();
      const sliderBox = await slider.boundingBox();
      expect(scrollbarBox).toBeTruthy();
      expect(sliderBox).toBeTruthy();
      const x = sliderBox!.x + sliderBox!.width / 2;
      await page.mouse.move(x, sliderBox!.y + sliderBox!.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, scrollbarBox!.y + scrollbarBox!.height - 2, { steps: 8 });
      await page.mouse.up();
    };

    // xterm 6 owns scrolling through its custom visible scrollbar rather than a native viewport.
    // Dragging to the loaded-history boundary is the deterministic real-user equivalent of many
    // wheel/page-up gestures across a multi-thousand-line retained tail.
    await dragHistorySliderToTop();
    await expect.poll(() => historyRequestCount, { timeout: 10_000 }).toBeGreaterThan(0);
    await expect.poll(() => historyResponseCount, { timeout: 10_000 }).toBeGreaterThan(0);

    // The response confirms the previous page has finished rebuilding. Dragging to the top again
    // now navigates into the prepended page without depending on xterm's internal slider geometry.
    await dragHistorySliderToTop();
    await expect
      .poll(async () => (await rows.locator(':scope > div').allTextContents()).join(''), { timeout: 10_000 })
      .toContain(earlyMarker);

    const requestsBeforeReturningToTail = historyRequestCount;
    await dragHistorySliderToBottom();
    await expect
      .poll(async () => (await rows.locator(':scope > div').allTextContents()).join(''), { timeout: 10_000 })
      .toContain(tailMarker);
    await expect(rows).not.toContainText(earlyMarker);

    // Returning to the live tail resets the history cursor. Re-entering history should request
    // the newest previous page again instead of keeping an exhausted cursor from the prior browse.
    await dragHistorySliderToTop();
    await expect.poll(() => historyRequestCount, { timeout: 10_000 }).toBeGreaterThan(requestsBeforeReturningToTail);
  } finally {
    expect((await context.request.put('/api/v1/settings/layout', { data: originalLayout })).ok()).toBeTruthy();
  }
});
