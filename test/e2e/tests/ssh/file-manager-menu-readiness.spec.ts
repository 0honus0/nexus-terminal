import { expect, test, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  fileManagerRow,
  openConnectedFileManager,
  resetTestSshFilesystem,
  E2E_SSH,
} from '../../support/ssh';
import { step } from '../../support/steps';

const contextMenu = (page: Page) => page.getByTestId('file-manager-context-menu');
const visibleFileManagerList = (page: Page) => page.locator('[data-testid="file-manager-list"]:visible').first();
const visibleFileManagerRow = (page: Page, filename: string) => visibleFileManagerList(page).locator(`tr[data-filename="${filename}"]`);

async function rightClickFile(page: Page, filename: string): Promise<void> {
  const row = fileManagerRow(page, filename);
  await expect(row).toBeVisible();
  await row.click({ button: 'right' });
  await expect(contextMenu(page)).toBeVisible();
}

test('a non-fatal WebSocket error does not leave file manager context actions greyed out', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);

  const receivedFrames: string[] = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', (event) => receivedFrames.push(String(event.payload)));
  });

  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);

  await step('backend generic errors do not poison SSH or SFTP readiness', async () => {
    await page.evaluate(async () => {
      const { useSessionStore } = await import('/src/stores/session.store.ts');
      const store = useSessionStore();
      const session = store.activeSession;
      if (!session) throw new Error('No active E2E session');
      session.wsManager.sendMessage({ type: 'e2e:unsupported-nonfatal-message' } as any);
    });

    await expect.poll(() => receivedFrames.some((frame) => {
      try {
        const message = JSON.parse(frame);
        return message?.type === 'error' && String(message?.payload ?? '').includes('e2e:unsupported-nonfatal-message');
      } catch {
        return false;
      }
    }), { timeout: 10_000 }).toBeTruthy();

    await expect.poll(() => page.evaluate(async () => {
      const { useSessionStore } = await import('/src/stores/session.store.ts');
      const store = useSessionStore();
      const session = store.activeSession;
      return {
        connected: session?.wsManager.isConnected.value ?? false,
        sftpReady: session?.wsManager.isSftpReady.value ?? false,
      };
    })).toEqual({ connected: true, sftpReady: true });
  });

  await step('a duplicate ssh:connect is treated as a no-op instead of disabling SFTP', async () => {
    await page.evaluate(async () => {
      const { useSessionStore } = await import('/src/stores/session.store.ts');
      const store = useSessionStore();
      const session = store.activeSession;
      if (!session) throw new Error('No active E2E session');
      session.wsManager.sendMessage({
        type: 'ssh:connect',
        payload: {
          connectionId: session.connectionId,
          clientSessionId: store.activeSessionId,
        },
      } as any);
    });

    await expect.poll(() => receivedFrames.some((frame) => {
      try {
        const message = JSON.parse(frame);
        return message?.type === 'info' && String(message?.payload ?? '').includes('重复连接请求');
      } catch {
        return false;
      }
    }), { timeout: 10_000 }).toBeTruthy();

    await expect.poll(() => page.evaluate(async () => {
      const { useSessionStore } = await import('/src/stores/session.store.ts');
      const session = useSessionStore().activeSession;
      return {
        connected: session?.wsManager.isConnected.value ?? false,
        sftpReady: session?.wsManager.isSftpReady.value ?? false,
      };
    })).toEqual({ connected: true, sftpReady: true });
  });

  await step('right-click actions remain enabled and Refresh still performs real SFTP work', async () => {
    const fixtureName = 'after-nonfatal-error.txt';
    const fixtureResponse = await fetch(`${E2E_SSH.controlUrl}/fixture?name=${encodeURIComponent(fixtureName)}`, { method: 'POST' });
    expect(fixtureResponse.ok).toBeTruthy();
    await expect(fileManagerRow(page, fixtureName)).toHaveCount(0);

    await rightClickFile(page, 'seed.txt');
    for (const label of ['Copy', 'Rename', 'Delete', 'Refresh']) {
      await expect(contextMenu(page).getByText(label, { exact: true }).first().locator('..')).toHaveAttribute('aria-disabled', 'false');
    }
    await expect(contextMenu(page).locator('li').filter({ hasText: /^Compress/ }).first()).toHaveAttribute('aria-disabled', 'false');

    await contextMenu(page).getByText('Refresh', { exact: true }).first().click();
    await expect(fileManagerRow(page, fixtureName)).toBeVisible({ timeout: 20_000 });
  });
});

test('switching SSH sessions without a page reload keeps file manager context actions bound to the active SFTP session', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);

  await connectTestSshFromConnectionsPage(page, connectionId);
  await expect(visibleFileManagerRow(page, 'seed.txt')).toBeVisible({ timeout: 20_000 });

  const firstSessionId = await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/stores/session.store.ts');
    const store = useSessionStore();
    if (!store.activeSessionId) throw new Error('No initial active SSH session');
    return store.activeSessionId;
  });

  await step('open a second SSH session while the existing file manager component stays mounted', async () => {
    await page.evaluate(async (targetConnectionId) => {
      const { useSessionStore } = await import('/src/stores/session.store.ts');
      useSessionStore().openNewSession(targetConnectionId);
    }, connectionId);

    await expect.poll(() => page.evaluate(async (oldSessionId) => {
      const { useSessionStore } = await import('/src/stores/session.store.ts');
      const store = useSessionStore();
      const active = store.activeSession;
      return {
        changed: !!store.activeSessionId && store.activeSessionId !== oldSessionId,
        connected: active?.wsManager.isConnected.value ?? false,
        sftpReady: active?.wsManager.isSftpReady.value ?? false,
      };
    }, firstSessionId), { timeout: 20_000 }).toEqual({ changed: true, connected: true, sftpReady: true });

    await expect(visibleFileManagerRow(page, 'seed.txt')).toBeVisible({ timeout: 20_000 });
  });

  await step('disconnect the old session so stale readiness refs become false', async () => {
    await page.evaluate(async (oldSessionId) => {
      const { useSessionStore } = await import('/src/stores/session.store.ts');
      useSessionStore().closeSession(oldSessionId);
    }, firstSessionId);

    await expect.poll(() => page.evaluate(async (oldSessionId) => {
      const { useSessionStore } = await import('/src/stores/session.store.ts');
      const store = useSessionStore();
      const active = store.activeSession;
      return {
        oldSessionRemoved: !store.sessions.has(oldSessionId),
        activeIsDifferent: !!store.activeSessionId && store.activeSessionId !== oldSessionId,
        connected: active?.wsManager.isConnected.value ?? false,
        sftpReady: active?.wsManager.isSftpReady.value ?? false,
      };
    }, firstSessionId)).toEqual({
      oldSessionRemoved: true,
      activeIsDifferent: true,
      connected: true,
      sftpReady: true,
    });
  });

  await step('right-click actions use the replacement session readiness and still perform SFTP work', async () => {
    const fixtureName = 'after-session-switch.txt';
    const fixtureResponse = await fetch(`${E2E_SSH.controlUrl}/fixture?name=${encodeURIComponent(fixtureName)}`, { method: 'POST' });
    expect(fixtureResponse.ok).toBeTruthy();
    await expect(visibleFileManagerRow(page, fixtureName)).toHaveCount(0);

    const row = visibleFileManagerRow(page, 'seed.txt');
    await row.click({ button: 'right' });
    await expect(contextMenu(page)).toBeVisible();

    for (const label of ['Copy', 'Rename', 'Delete', 'Refresh']) {
      await expect(contextMenu(page).getByText(label, { exact: true }).first().locator('..')).toHaveAttribute('aria-disabled', 'false');
    }
    await expect(contextMenu(page).locator('li').filter({ hasText: /^Compress/ }).first()).toHaveAttribute('aria-disabled', 'false');

    await contextMenu(page).getByText('Refresh', { exact: true }).first().click();
    await expect(visibleFileManagerRow(page, fixtureName)).toBeVisible({ timeout: 20_000 });
  });
});

