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
  decodeWorkspaceBinaryFrame,
  openAuthenticatedWebSocket,
  openWorkspaceSession,
  requestWorkspace,
  requestWorkspaceBinary,
  sendJson,
  waitForFilesystemReady,
  waitForBinaryText,
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
      ownershipState: 'available' | 'resuming' | 'attached';
      attachedWorkspaceId?: string;
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
    expect(listAfter.find((session) => session.id === suspended!.id)).toMatchObject({
      originalWorkspaceId: original.workspaceId,
      connectionId,
      status: 'active',
      ownershipState: 'attached',
      attachedWorkspaceId: resumedWorkspaceId,
    });

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

test('a second device explicitly takes over an attached suspended SSH owner without replacing the shell', async ({
  request,
}) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const original = await openWorkspaceSession(request, connectionId, `takeover-origin-${crypto.randomUUID()}`);
  const marker = `TAKEOVER_${crypto.randomUUID().replaceAll('-', '')}`;
  const originalMarkerOutput = waitForBinaryText(original.socket, marker);
  await requestWorkspace(original.socket, 'terminal.input', {
    data: `export NEXUS_TAKEOVER_MARKER=${marker}; cd folder-seed; printf '${marker}\n'\n`,
  });
  await originalMarkerOutput;
  await requestWorkspace(original.socket, 'suspend.mark');
  await closeWebSocket(original.socket);

  type SuspendedSession = {
    id: string;
    originalWorkspaceId: string;
    status: 'active' | 'disconnected';
    ownershipState: 'available' | 'resuming' | 'attached';
    ownershipGeneration: number;
    attachedWorkspaceId?: string;
  };
  const ownerA = await openAuthenticatedWebSocket(request);
  const ownerB = await openAuthenticatedWebSocket(request);
  let suspended: SuspendedSession | undefined;
  try {
    for (let attempt = 0; attempt < 30 && !suspended; attempt += 1) {
      const list = await requestWorkspace<SuspendedSession[]>(ownerA, 'suspend.list');
      suspended = list.find(
        (session) => session.originalWorkspaceId === original.workspaceId && session.status === 'active',
      );
      if (!suspended) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(suspended).toBeTruthy();

    const workspaceA = `takeover-a-${crypto.randomUUID()}`;
    const resumedA = await requestWorkspace<{
      workspaceId: string;
      resumedFrom: string;
      ownershipGeneration: number;
    }>(ownerA, 'suspend.resume', {
      suspendedSessionId: suspended!.id,
      workspaceId: workspaceA,
    });
    expect(resumedA).toMatchObject({ workspaceId: workspaceA, resumedFrom: suspended!.id });
    await waitForFilesystemReady(ownerA);

    const attached = (await requestWorkspace<SuspendedSession[]>(ownerB, 'suspend.list')).find(
      (session) => session.id === suspended!.id,
    );
    expect(attached).toMatchObject({
      status: 'active',
      ownershipState: 'attached',
      attachedWorkspaceId: workspaceA,
      ownershipGeneration: resumedA.ownershipGeneration,
    });

    await expect(
      requestWorkspace(ownerB, 'suspend.resume', {
        suspendedSessionId: suspended!.id,
        workspaceId: `takeover-denied-${crypto.randomUUID()}`,
      }),
    ).rejects.toThrow(/SUSPENDED_SESSION_OWNED/);

    const revokedA = new Promise<{ reason?: string; generation?: number }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for suspended ownership revoke')), 10_000);
      const onMessage = (raw: Buffer, isBinary: boolean) => {
        if (isBinary) return;
        let message: { type?: string; payload?: { reason?: string; generation?: number } };
        try {
          message = JSON.parse(Buffer.from(raw).toString('utf8')) as typeof message;
        } catch {
          return;
        }
        if (message.type !== 'suspend.revoked') return;
        clearTimeout(timeout);
        ownerA.off('message', onMessage);
        resolve(message.payload ?? {});
      };
      ownerA.on('message', onMessage);
    });
    const ownerAClosed = new Promise<{ code: number; reason: string }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for revoked owner socket close')), 10_000);
      ownerA.once('close', (code: number, reason: Buffer) => {
        clearTimeout(timeout);
        resolve({ code, reason: reason.toString('utf8') });
      });
    });

    const workspaceB = `takeover-b-${crypto.randomUUID()}`;
    const resumedB = await requestWorkspace<{
      workspaceId: string;
      resumedFrom: string;
      ownershipGeneration: number;
    }>(ownerB, 'suspend.resume', {
      suspendedSessionId: suspended!.id,
      workspaceId: workspaceB,
      takeover: true,
    });
    expect(resumedB).toMatchObject({ workspaceId: workspaceB, resumedFrom: suspended!.id });
    expect(resumedB.ownershipGeneration).toBeGreaterThan(resumedA.ownershipGeneration);
    await expect(revokedA).resolves.toMatchObject({ reason: 'takeover', generation: resumedA.ownershipGeneration });
    await expect(ownerAClosed).resolves.toMatchObject({
      code: 4009,
      reason: 'Suspended session ownership was taken over by another device.',
    });

    const sameShellOutput = waitForBinaryText(ownerB, `TAKEOVER_STATE=${marker}`);
    await requestWorkspace(ownerB, 'terminal.input', {
      data: `printf 'TAKEOVER_STATE=%s CWD=%s\n' "$NEXUS_TAKEOVER_MARKER" "$PWD"\n`,
    });
    const terminalOutput = await sameShellOutput;
    expect(terminalOutput).toContain(`TAKEOVER_STATE=${marker}`);
    expect(terminalOutput).toContain('folder-seed');

    const afterTakeover = (await requestWorkspace<SuspendedSession[]>(ownerB, 'suspend.list')).find(
      (session) => session.id === suspended!.id,
    );
    expect(afterTakeover).toMatchObject({
      status: 'active',
      ownershipState: 'attached',
      attachedWorkspaceId: workspaceB,
      ownershipGeneration: resumedB.ownershipGeneration,
    });
    await requestWorkspace(ownerB, 'suspend.unmark');
  } finally {
    await closeWebSocket(ownerA);
    await closeWebSocket(ownerB);
    if (suspended) await request.delete(`/api/v1/ssh-suspend/terminate/${suspended.id}`).catch(() => undefined);
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
    ownershipState: 'available' | 'resuming' | 'attached';
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
          session.ownershipState === 'available' &&
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

  // Queue output before the handoff, but make it arrive after suspend.mark has transferred
  // ownership to the server. The old client socket is intentionally no longer writable afterward.
  await requestWorkspace(workspace.socket, 'terminal.input', {
    data: `(sleep 0.5; printf '${after}\\n') &\r`,
  });
  await new Promise((resolve) => setTimeout(resolve, 75));
  await requestWorkspace(workspace.socket, 'suspend.mark', { terminalSnapshot: `${before}\r\n` });
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
    let text = '';
    await expect
      .poll(
        async () => {
          const exported = await request.get(`/api/v1/ssh-suspend/log/${suspended!.id}`);
          expect(exported.ok()).toBeTruthy();
          text = await exported.text();
          return text;
        },
        { timeout: 5_000 },
      )
      .toContain(after);
    expect(text).toContain(before);
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
      if (!isBinary) return;
      const frame = decodeWorkspaceBinaryFrame(Buffer.from(data));
      if (frame.type === 1) initialChunks.push(frame.payload);
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
    const cachedTailEnd = initialOutput.indexOf(tailMarker);
    expect(cachedTailEnd).toBeGreaterThanOrEqual(0);
    const cachedTail = initialOutput.slice(0, cachedTailEnd + tailMarker.length);
    // commitResume can append live PTY output immediately after the cached history payload. Only
    // the bounded prefix through the known tail marker belongs to initial resume history.
    expect(Buffer.byteLength(cachedTail)).toBeLessThanOrEqual(256 * 1024);
    expect(cachedTail).toContain(tailMarker);
    expect(cachedTail).not.toContain(earlyMarker);

    let older = '';
    let firstPreviousPage: { data: { hasMore: boolean }; bytes: Buffer } | null = null;
    let hasMore = resumed.historyAvailable;
    let pages = 0;
    while (hasMore && pages < 10) {
      const page = await requestWorkspaceBinary<{ hasMore: boolean }>(recoverySocket, 'suspend.history.previous');
      firstPreviousPage ??= page;
      const text = page.bytes.toString('utf8');
      older = text + older;
      hasMore = page.data.hasMore;
      pages += 1;
    }
    expect(hasMore).toBe(false);
    expect(pages).toBeGreaterThan(0);
    const restoredHistory = `${older}${cachedTail}`;
    expect(restoredHistory).toContain(earlyMarker);
    expect(restoredHistory).toContain(tailMarker);

    const reset = await requestWorkspace<{ available: boolean }>(recoverySocket, 'suspend.history.reset');
    expect(reset.available).toBe(true);
    const replayedFirstPage = await requestWorkspaceBinary<{ hasMore: boolean }>(
      recoverySocket,
      'suspend.history.previous',
    );
    expect(replayedFirstPage.data).toEqual(firstPreviousPage!.data);
    expect(replayedFirstPage.bytes.equals(firstPreviousPage!.bytes)).toBe(true);
    await requestWorkspace(recoverySocket, 'suspend.history.reset');
    const boundedPage = await requestWorkspaceBinary<{ hasMore: boolean }>(recoverySocket, 'suspend.history.previous', {
      maxBytes: 16 * 1024,
    });
    expect(boundedPage.bytes.byteLength).toBeLessThanOrEqual(16 * 1024);
    expect(boundedPage.data.hasMore).toBe(true);
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
    await expect(scrollable).toBeVisible();
    const scrollableBox = await scrollable.boundingBox();
    expect(scrollableBox).toBeTruthy();
    await page.mouse.move(scrollableBox!.x + scrollableBox!.width / 2, scrollableBox!.y + scrollableBox!.height / 2);
    const scrollbar = scrollable.locator(':scope > .scrollbar.vertical').first();
    const slider = scrollbar.locator(':scope > .slider');
    const sliderBox = async () => {
      let box = await slider.boundingBox();
      await expect
        .poll(
          async () => {
            box = await slider.boundingBox();
            return Boolean(box && box.width > 0 && box.height > 0);
          },
          { timeout: 10_000 },
        )
        .toBe(true);
      return box!;
    };
    const dragHistorySliderToTop = async () => {
      await page.mouse.move(scrollableBox!.x + scrollableBox!.width - 2, scrollableBox!.y + scrollableBox!.height / 2);
      await expect(scrollbar).toHaveClass(/visible/);
      const scrollbarBox = await scrollbar.boundingBox();
      const currentSliderBox = await sliderBox();
      expect(scrollbarBox).toBeTruthy();
      const x = currentSliderBox.x + currentSliderBox.width / 2;
      await page.mouse.move(x, currentSliderBox.y + currentSliderBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, scrollbarBox!.y + 2, { steps: 8 });
      await page.mouse.up();
    };
    const dragHistorySliderToBottom = async () => {
      await page.mouse.move(scrollableBox!.x + scrollableBox!.width - 2, scrollableBox!.y + scrollableBox!.height / 2);
      await expect(scrollbar).toHaveClass(/visible/);
      const scrollbarBox = await scrollbar.boundingBox();
      const currentSliderBox = await sliderBox();
      expect(scrollbarBox).toBeTruthy();
      const x = currentSliderBox.x + currentSliderBox.width / 2;
      await page.mouse.move(x, currentSliderBox.y + currentSliderBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(x, scrollbarBox!.y + scrollbarBox!.height - 2, { steps: 8 });
      await page.mouse.up();
    };

    const renderedTerminalText = async (): Promise<string> =>
      (await rows.locator(':scope > div').allTextContents()).join('');
    const wheelUntil = async (
      deltaY: number,
      predicate: () => boolean | Promise<boolean>,
      failureMessage: string,
    ): Promise<void> => {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (await predicate()) return;
        await page.mouse.wheel(0, deltaY);
        await page.waitForTimeout(75);
      }
      expect(await predicate(), failureMessage).toBe(true);
    };

    await wheelUntil(-6_000, () => historyRequestCount > 0, 'scrolling upward should request older history');
    await expect.poll(() => historyResponseCount, { timeout: 10_000 }).toBeGreaterThan(0);

    for (let pageIndex = 0; pageIndex < 30 && !(await renderedTerminalText()).includes(earlyMarker); pageIndex += 1) {
      await dragHistorySliderToTop();
      await page.mouse.move(scrollableBox!.x + scrollableBox!.width / 2, scrollableBox!.y + scrollableBox!.height / 2);
      await page.mouse.wheel(0, -6_000);
      await page.waitForTimeout(100);
    }
    expect(await renderedTerminalText()).toContain(earlyMarker);

    const requestsBeforeReturningToTail = historyRequestCount;
    await dragHistorySliderToBottom();
    await expect.poll(renderedTerminalText, { timeout: 10_000 }).toContain(tailMarker);
    await expect(rows).not.toContainText(earlyMarker);

    // Returning to the live tail resets the history cursor. Re-entering history should request
    // the newest previous page again instead of keeping an exhausted cursor from the prior browse.
    await dragHistorySliderToTop();
    await page.mouse.move(scrollableBox!.x + scrollableBox!.width / 2, scrollableBox!.y + scrollableBox!.height / 2);
    await wheelUntil(
      -6_000,
      () => historyRequestCount > requestsBeforeReturningToTail,
      're-entering history should request an older page',
    );
  } finally {
    expect((await context.request.put('/api/v1/settings/layout', { data: originalLayout })).ok()).toBeTruthy();
  }
});
