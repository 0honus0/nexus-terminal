import type { WebSocketRoute } from '@playwright/test';
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

test('mobile suspended catalog refreshes promptly after a marked tab closes', async ({ page, context }) => {
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
    await tab.getByRole('button', { name: 'Close Tab', exact: true }).click();

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
  // Keep the byte history larger than the initial 256 KiB resume tail without creating
  // thousands of visible rows. A run of carriage returns is terminal-safe filler.
  const snapshot = `${earlyMarker}\r\n${'\r'.repeat(300_000)}${tailMarker}\r\n`;
  expect(Buffer.byteLength(snapshot)).toBeGreaterThan(256 * 1024);

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
  for (let attempt = 0; attempt < 3 && !(await rows.innerText()).includes(earlyMarker); attempt += 1) {
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

test('mobile foreground recovery replaces a suspended tab without exposing a temporary duplicate', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  let workspaceRoute: WebSocketRoute | undefined;
  await page.routeWebSocket('**/ws/workspace', (route) => {
    route.connectToServer();
    workspaceRoute = route;
  });
  await connectTestSshFromConnectionsPage(page, connectionId);
  await expect.poll(() => Boolean(workspaceRoute), { timeout: 20_000 }).toBe(true);

  const tabBar = page.getByTestId('terminal-tab-bar');
  const tab = tabBar.locator('[data-session-id]').filter({ hasText: 'E2E SSH' }).first();
  await expect(tab).toBeVisible({ timeout: 20_000 });
  const originalSessionId = (await tab.getAttribute('data-session-id')) ?? '';
  expect(originalSessionId).not.toBe('');

  await tab.click({ button: 'right' });
  await page.getByText('Suspend Session', { exact: true }).click();
  await tab.click({ button: 'right' });
  await expect(page.getByText('Unmark Suspend', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');

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

  const dispatchVisibility = async (state: 'hidden' | 'visible') => {
    await page.evaluate((nextState) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => nextState });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => nextState === 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
  };

  try {
    await dispatchVisibility('hidden');
    await workspaceRoute!.close({ code: 4001, reason: 'E2E suspend takeover' });
    await expect
      .poll(
        async () =>
          (await suspendedSessions(context.request)).some(
            (session) => session.originalWorkspaceId === originalSessionId && session.status === 'active',
          ),
        { timeout: 30_000 },
      )
      .toBeTruthy();

    await dispatchVisibility('visible');

    await expect.poll(() => tabBar.locator('[data-session-id]').count(), { timeout: 30_000 }).toBe(1);
    await expect
      .poll(
        async () =>
          (await suspendedSessions(context.request)).some(
            (session) => session.originalWorkspaceId === originalSessionId,
          ),
        { timeout: 30_000 },
      )
      .toBeFalsy();

    const maxTabs = await page.evaluate(() => {
      return (window as typeof window & { __suspendTabState?: { maxTabs: number } }).__suspendTabState?.maxTabs ?? 0;
    });
    expect(maxTabs).toBe(1);

    const resumedTab = tabBar.locator('[data-session-id]').filter({ hasText: 'E2E SSH' }).first();
    await expect(resumedTab).toBeVisible();
    await resumedTab.click({ button: 'right' });
    await expect(page.getByText('Unmark Suspend', { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByText('Unmark Suspend', { exact: true }).click();
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

  await step('retain terminal output produced after the suspend mark', async () => {
    await commandInput.fill('printf \'AFTER_MARK_BEFORE_SUSPEND=%s\\n\' "$PWD"');
    await commandInput.press('Enter');
    await expect.poll(terminalText, { timeout: 15_000 }).toContain('AFTER_MARK_BEFORE_SUSPEND=');
    await expect.poll(terminalText, { timeout: 15_000 }).toContain('folder-seed');
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
    const originalViewport = page.viewportSize();
    expect(originalViewport).toBeTruthy();
    // Exercise the wider narrow-container band too. At a 480px viewport the modal's
    // inner suspended-session pane is roughly 400px wide, matching narrow desktop/Windows panes.
    await page.setViewportSize({ width: 480, height: originalViewport!.height });
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
    expect(box!.height).toBeGreaterThanOrEqual(Math.min(360, viewport!.height - 34));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport!.width);
    const modalBody = dialog.getByTestId('suspended-sessions-modal-body');
    const modalBodyBox = await modalBody.boundingBox();
    expect(modalBodyBox).toBeTruthy();
    expect(modalBodyBox!.height).toBeGreaterThan(220);
    const dialogRegion = dialog.getByRole('region', { name: 'Suspended SSH Sessions', exact: true });
    await expect(dialogRegion.locator('.session-list-container')).toHaveCSS('overflow-y', 'auto');
    const containerContentWidth = () =>
      dialogRegion.evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          element.clientWidth -
          Number.parseFloat(style.paddingLeft || '0') -
          Number.parseFloat(style.paddingRight || '0')
        );
      });
    const suspendedCard = dialogRegion.locator('[data-testid^="suspended-session-"]').first();
    await expect(suspendedCard).toBeVisible({ timeout: 20_000 });
    const readCompactGeometry = async () => {
      await suspendedCard.scrollIntoViewIfNeeded();
      await expect(suspendedCard.locator('.status-badge')).toHaveCSS('margin-left', '0px');
      await expect(suspendedCard.locator('.button-session-text').first()).toHaveCSS('display', 'none');
      await expect(suspendedCard.locator('.session-status-actions .actions')).toHaveCSS('flex-direction', 'row');
      return suspendedCard.evaluate((card) => {
        const row = card.querySelector<HTMLElement>('.session-row')?.getBoundingClientRect();
        const info = card.querySelector<HTMLElement>('.session-info')?.getBoundingClientRect();
        const actions = card.querySelector<HTMLElement>('.session-status-actions')?.getBoundingClientRect();
        const name = card.querySelector<HTMLElement>('.session-name')?.getBoundingClientRect();
        const actionGroup = card
          .querySelector<HTMLElement>('.session-status-actions .actions')
          ?.getBoundingClientRect();
        const buttons = [...card.querySelectorAll<HTMLElement>('.session-action')].map((button) => {
          const rect = button.getBoundingClientRect();
          return {
            width: rect.width,
            height: rect.height,
            top: rect.top,
            paddingLeft: Number.parseFloat(getComputedStyle(button).paddingLeft),
          };
        });
        if (!row || !info || !actions || !name || !actionGroup) return null;
        return {
          clientWidth: card.clientWidth,
          scrollWidth: card.scrollWidth,
          rowLeft: row.left,
          rowRight: row.right,
          rowTop: row.top,
          rowBottom: row.bottom,
          rowWidth: row.width,
          infoLeft: info.left,
          infoRight: info.right,
          infoTop: info.top,
          infoWidth: info.width,
          infoBottom: info.bottom,
          actionsLeft: actions.left,
          actionsRight: actions.right,
          actionsTop: actions.top,
          actionsBottom: actions.bottom,
          actionGroupWidth: actionGroup.width,
          nameWidth: name.width,
          metaOverflow: [...card.querySelectorAll<HTMLElement>('.session-meta')].some(
            (element) => element.scrollWidth > element.clientWidth + 1,
          ),
          buttons,
        };
      });
    };
    const assertCompactButtons = async () => {
      const geometry = await readCompactGeometry();
      expect(geometry).toBeTruthy();
      expect(geometry!.scrollWidth).toBeLessThanOrEqual(geometry!.clientWidth + 1);
      expect(geometry!.metaOverflow).toBeFalsy();
      expect(geometry!.nameWidth).toBeGreaterThan(40);
      expect(geometry!.buttons.length).toBeGreaterThanOrEqual(2);
      expect(
        geometry!.buttons.every(
          (button) =>
            Math.abs(button.width - 28) <= 0.5 &&
            Math.abs(button.height - 28) <= 0.5 &&
            Math.abs(button.top - geometry!.buttons[0].top) <= 0.5,
        ),
      ).toBeTruthy();
      return geometry!;
    };
    const assertInlineCompactCard = async () => {
      await expect(suspendedCard.locator('.session-info')).toHaveCSS('text-align', 'left');
      const geometry = await assertCompactButtons();
      expect(geometry.infoWidth).toBeGreaterThan(130);
      expect(geometry.actionsLeft).toBeGreaterThanOrEqual(geometry.infoRight - 1);
      expect(geometry.actionsTop).toBeLessThan(geometry.infoBottom - 1);
      expect(geometry.actionsRight).toBeLessThanOrEqual(geometry.rowRight + 1);
      return geometry;
    };
    const assertStackedCompactCard = async () => {
      await expect(suspendedCard.locator('.session-info')).toHaveCSS('text-align', 'center');
      const geometry = await assertCompactButtons();
      expect(geometry.infoWidth).toBeGreaterThan(geometry.rowWidth * 0.9);
      expect(geometry.actionsTop).toBeGreaterThanOrEqual(geometry.infoBottom - 1);
      expect(geometry.actionGroupWidth).toBeLessThanOrEqual(116);
      expect(
        Math.abs((geometry.actionsLeft + geometry.actionsRight) / 2 - (geometry.rowLeft + geometry.rowRight) / 2),
      ).toBeLessThanOrEqual(1);
      return geometry;
    };

    // Medium mobile/narrow panes first collapse text actions into icons but keep them beside the
    // session information. Do not spend vertical space until the row is genuinely too narrow.
    await expect.poll(async () => (await dialogRegion.boundingBox())?.width ?? 999).toBeLessThanOrEqual(420);
    await expect.poll(async () => (await dialogRegion.boundingBox())?.width ?? 0).toBeGreaterThan(320);
    await assertInlineCompactCard();

    // A typical phone width still keeps the compact icon group on the same row.
    await page.setViewportSize({ width: 360, height: originalViewport!.height });
    await expect.poll(async () => (await dialogRegion.boundingBox())?.width ?? 999).toBeLessThanOrEqual(320);
    await expect.poll(containerContentWidth).toBeGreaterThan(260);
    await assertInlineCompactCard();

    // At the minimum supported phone width, move actions below the information only when they
    // would otherwise collide. The icon group stays content-width instead of stretching across
    // the whole card.
    await page.setViewportSize({ width: 320, height: originalViewport!.height });
    await expect.poll(async () => (await dialogRegion.boundingBox())?.width ?? 999).toBeLessThanOrEqual(280);
    await expect.poll(containerContentWidth).toBeLessThanOrEqual(260);
    await assertStackedCompactCard();

    // Combined minimum-width + low-height mode preserves the 28px controls without re-expanding
    // the action group.
    await page.setViewportSize({ width: 320, height: 320 });
    await expect.poll(async () => (await dialogRegion.boundingBox())?.height ?? 999).toBeLessThanOrEqual(280);
    const lowHeightGeometry = await assertStackedCompactCard();
    expect(lowHeightGeometry.buttons.every((button) => button.paddingLeft === 0)).toBeTruthy();

    // Above the compact threshold, retain the regular desktop-style text actions.
    await page.setViewportSize({ width: 700, height: originalViewport!.height });
    await expect.poll(async () => (await dialogRegion.boundingBox())?.width ?? 0).toBeGreaterThan(420);
    await expect(suspendedCard.locator('.button-session-text').first()).not.toHaveCSS('display', 'none');
    await expect(suspendedCard.locator('.session-status-actions .actions')).toHaveCSS('flex-direction', 'column');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.setViewportSize(originalViewport!);
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
    expect(exportedBeforeResume).toContain('AFTER_MARK_BEFORE_SUSPEND=');

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
    expect(resumedLogText).toContain('AFTER_MARK_BEFORE_SUSPEND=');
    expect(resumedLogText).toContain('AFTER_RESUME=');
    expect((await context.request.delete(`/api/v1/ssh-suspend/terminate/${resuspended!.id}`)).ok()).toBeTruthy();
  });
});
