import { writeFile } from 'node:fs/promises';
import type { APIRequestContext, Page, TestInfo } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  E2E_SSH,
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
  setTestSshOnline,
} from '../../support/ssh';
import { step } from '../../support/steps';

const MULTI_SESSION_NAMES = [
  'M08 Workspace Session Alpha Long Label',
  'M08 Workspace Session Bravo Long Label',
  'M08 Workspace Session Charlie Long Label',
] as const;

async function removeMultiSessionConnections(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/v1/connections');
  expect(response.ok()).toBeTruthy();
  const connections = (await response.json()) as Array<{ id: number; name?: string | null }>;
  for (const connection of connections.filter((item) =>
    MULTI_SESSION_NAMES.includes(item.name as (typeof MULTI_SESSION_NAMES)[number]),
  )) {
    const remove = await request.delete(`/api/v1/connections/${connection.id}`);
    expect(remove.ok()).toBeTruthy();
  }
}

async function createMultiSessionConnections(request: APIRequestContext): Promise<number[]> {
  const ids: number[] = [];
  for (const name of MULTI_SESSION_NAMES) {
    const response = await request.post('/api/v1/connections', {
      data: {
        name,
        type: 'SSH',
        host: E2E_SSH.host,
        port: E2E_SSH.port,
        username: E2E_SSH.username,
        authMethod: 'password',
        password: E2E_SSH.password,
      },
    });
    expect(response.status()).toBe(201);
    ids.push(((await response.json()) as { connection: { id: number } }).connection.id);
  }
  return ids;
}

async function openConnectionFromWorkspacePicker(page: Page, connectionId: number): Promise<void> {
  await page.getByRole('button', { name: 'New Connection Tab', exact: true }).click();
  const picker = page.getByRole('heading', { name: 'Select server to connect', exact: true });
  await expect(picker).toBeVisible();
  const row = page.locator(`[data-testid="workspace-connection-list"] [data-connection-id="${connectionId}"]`);
  await expect(row).toBeVisible();
  await row.click();
  await expect(picker).toBeHidden();
  await expect(page.locator('[data-testid="command-input"]:visible')).toBeEnabled({ timeout: 20_000 });
}

async function captureWorkspaceEvidence(page: Page, testInfo: TestInfo, name: 'before' | 'after'): Promise<void> {
  const metrics = await page.evaluate(() => {
    const tabBar = document.querySelector<HTMLElement>('[data-testid="terminal-tab-bar"]');
    const tabScroller = tabBar?.querySelector<HTMLElement>('[class*="overflow-x-auto"]');
    const tabs = [...(tabBar?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const activeTab = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
    const rect = (element: Element | null) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom };
    };
    return {
      language: document.documentElement.lang,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      pageScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      tabBar: rect(tabBar),
      tabScroller: rect(tabScroller),
      tabScrollerClientWidth: tabScroller?.clientWidth ?? 0,
      tabScrollerScrollWidth: tabScroller?.scrollWidth ?? 0,
      tabScrollerScrollLeft: tabScroller?.scrollLeft ?? 0,
      tabCount: tabs.length,
      activeTabText: activeTab?.textContent?.trim() ?? '',
      activeTabId: activeTab?.getAttribute('data-session-id') ?? null,
      backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--app-bg-color').trim(),
    };
  });
  const screenshotPath = testInfo.outputPath(`m08-session-${name}.png`);
  const metricsPath = testInfo.outputPath(`m08-session-${name}.metrics.json`);
  await page.screenshot({ path: screenshotPath, fullPage: false, animations: 'disabled', caret: 'hide' });
  await writeFile(metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  await testInfo.attach(`M08.03-a workspace ${name} screenshot`, { path: screenshotPath, contentType: 'image/png' });
  await testInfo.attach(`M08.03-a workspace ${name} metrics`, { path: metricsPath, contentType: 'application/json' });
  console.log(
    `[M08.03-a workspace ${name} metrics] language=${metrics.language} viewport=${metrics.viewport.width}x${metrics.viewport.height} pageScrollWidth=${metrics.pageScrollWidth} bodyScrollWidth=${metrics.bodyScrollWidth} tabs=${metrics.tabCount} tabScroller=${metrics.tabScrollerClientWidth}/${metrics.tabScrollerScrollWidth}/${metrics.tabScrollerScrollLeft}`,
  );
  expect(metrics.language).toMatch(/^en(?:-US)?$/);
  expect(metrics.viewport).toEqual({ width: 412, height: 915 });
  expect(metrics.pageScrollWidth).toBeLessThanOrEqual(metrics.viewport.width);
  expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.viewport.width);
  expect(metrics.tabBar?.x).toBeGreaterThanOrEqual(0);
  expect(metrics.tabBar?.right).toBeLessThanOrEqual(metrics.viewport.width + 1);
  expect(metrics.tabScroller?.x).toBeGreaterThanOrEqual(0);
  expect(metrics.tabScroller?.right).toBeLessThanOrEqual(metrics.viewport.width + 1);
}

test('disconnected SSH retries periodically and any key reconnects immediately', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await setTestSshOnline(true);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);

  let openedWebSockets = 0;
  let workspaceConnectRequests = 0;
  let workspaceConnectResponses = 0;
  const pendingWorkspaceConnectRequests = new Set<string>();
  page.on('websocket', (socket) => {
    if (!new URL(socket.url()).pathname.startsWith('/ws')) return;
    openedWebSockets += 1;
    socket.on('framesent', (event) => {
      if (typeof event.payload !== 'string') return;
      try {
        const message = JSON.parse(event.payload) as { type?: string; requestId?: string };
        if (message.type === 'workspace.connect' && message.requestId) {
          workspaceConnectRequests += 1;
          pendingWorkspaceConnectRequests.add(message.requestId);
        }
      } catch {
        // Ignore non-JSON frames.
      }
    });
    socket.on('framereceived', (event) => {
      if (typeof event.payload !== 'string') return;
      try {
        const message = JSON.parse(event.payload) as {
          type?: string;
          requestId?: string;
          payload?: { ok?: boolean };
        };
        if (
          message.type === 'response' &&
          message.requestId &&
          message.payload?.ok === true &&
          pendingWorkspaceConnectRequests.delete(message.requestId)
        ) {
          workspaceConnectResponses += 1;
        }
      } catch {
        // Ignore non-JSON frames; terminal output is normally binary.
      }
    });
  });

  await connectTestSshFromConnectionsPage(page, connectionId);
  const terminal = page.getByTestId('terminal');
  const xtermInput = terminal.locator('.xterm-helper-textarea');
  const commandInput = page.getByTestId('command-input');

  await step('initial SSH session is connected', async () => {
    await expect(terminal).toBeVisible({ timeout: 20_000 });
    await expect(xtermInput).toBeAttached();
    await expect.poll(() => openedWebSockets).toBeGreaterThanOrEqual(1);
    await expect.poll(() => workspaceConnectResponses, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  });

  const initialConnectRequestCount = workspaceConnectRequests;
  const initialConnectedCount = workspaceConnectResponses;

  try {
    await step('SSH outage triggers more than one automatic reconnect cycle', async () => {
      await setTestSshOnline(false);

      // First reconnect is scheduled after 2s and the next after 4s. The clean Workspace
      // transport may reuse the same already-open /ws/workspace control socket after an
      // SSH-level connect failure, so business reconnect attempts are counted by their
      // workspace.connect requests rather than by forcing a new WebSocket per attempt.
      await expect
        .poll(() => workspaceConnectRequests, { timeout: 12_000 })
        .toBeGreaterThanOrEqual(initialConnectRequestCount + 2);
    });

    await step('any terminal key interrupts backoff and reconnects immediately', async () => {
      await setTestSshOnline(true);
      const beforeKeypress = workspaceConnectRequests;

      await xtermInput.focus();
      await page.keyboard.press('x');

      // The scheduled retry is still in backoff. A fresh workspace.connect request
      // within 2.5s therefore comes from reconnectNow(), even when the control socket
      // itself is intentionally reused.
      await expect.poll(() => workspaceConnectRequests, { timeout: 2_500 }).toBeGreaterThan(beforeKeypress);
      await expect.poll(() => workspaceConnectResponses, { timeout: 5_000 }).toBeGreaterThan(initialConnectedCount);

      await commandInput.fill("printf 'NEXUS_RECONNECTED_E2E\\n'");
      await commandInput.press('Enter');
      await expect
        .poll(async () => terminal.locator('.xterm-rows').innerText(), { timeout: 10_000 })
        .toContain('NEXUS_RECONNECTED_E2E');
    });
  } finally {
    await setTestSshOnline(true);
  }
});

test.describe('M08.03-a mobile Workspace session lifecycle', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

  test('opens, switches, scrolls, context-closes, and empties real Workspace sessions', async ({
    page,
    context,
  }, testInfo) => {
    await loginAsInitialAdmin(context.request);
    await configureSshE2eSettings(context.request);
    await setTestSshOnline(true);
    await resetTestSshFilesystem();
    await removeMultiSessionConnections(context.request);
    const connectionIds = await createMultiSessionConnections(context.request);
    const workspaceConnectIds: string[] = [];
    page.on('websocket', (socket) => {
      if (!new URL(socket.url()).pathname.startsWith('/ws')) return;
      socket.on('framesent', (event) => {
        if (typeof event.payload !== 'string') return;
        try {
          const message = JSON.parse(event.payload) as {
            type?: string;
            payload?: { workspaceId?: string };
          };
          if (message.type === 'workspace.connect' && message.payload?.workspaceId)
            workspaceConnectIds.push(message.payload.workspaceId);
        } catch {
          return;
        }
      });
    });

    const tabs = page.getByTestId('terminal-tab-bar').locator('[role="tab"]');
    const tabForName = (name: string) => tabs.filter({ hasText: name });
    const activeTab = () => page.getByTestId('terminal-tab-bar').locator('[role="tab"][aria-selected="true"]');
    const visibleCommandInput = () => page.locator('[data-testid="command-input"]:visible').first();
    const visibleTerminalRows = () => page.locator('[data-testid="terminal"]:visible .xterm-rows').first();
    const sendMarker = async (marker: string) => {
      await visibleCommandInput().fill(`printf '${marker}\\n'`);
      await visibleCommandInput().press('Enter');
      await expect.poll(async () => visibleTerminalRows().innerText(), { timeout: 15_000 }).toContain(marker);
    };

    try {
      await step('open the first real SSH session and record its terminal state', async () => {
        await connectTestSshFromConnectionsPage(page, connectionIds[0]!);
        await expect(tabs).toHaveCount(1);
        await expect(tabForName(MULTI_SESSION_NAMES[0])).toHaveAttribute('aria-selected', 'true');
        await sendMarker('M08_ALPHA_SESSION_STATE');
        await captureWorkspaceEvidence(page, testInfo, 'before');
      });

      await step('add two sessions through the Workspace new-tab picker', async () => {
        await openConnectionFromWorkspacePicker(page, connectionIds[1]!);
        await expect(tabForName(MULTI_SESSION_NAMES[1])).toHaveAttribute('aria-selected', 'true');
        await sendMarker('M08_BRAVO_SESSION_STATE');

        await openConnectionFromWorkspacePicker(page, connectionIds[2]!);
        await expect(tabForName(MULTI_SESSION_NAMES[2])).toHaveAttribute('aria-selected', 'true');
        await sendMarker('M08_CHARLIE_SESSION_STATE');
        await expect(tabs).toHaveCount(3);
        await expect.poll(() => new Set(workspaceConnectIds).size, { timeout: 20_000 }).toBe(3);
        expect(workspaceConnectIds).toHaveLength(3);
      });

      await step('switch active tabs without recreating hidden live session state', async () => {
        await tabForName(MULTI_SESSION_NAMES[0]).click();
        await expect(activeTab()).toHaveText(new RegExp(MULTI_SESSION_NAMES[0]));
        await expect
          .poll(async () => visibleTerminalRows().innerText(), { timeout: 10_000 })
          .toContain('M08_ALPHA_SESSION_STATE');

        await tabForName(MULTI_SESSION_NAMES[1]).click();
        await expect(activeTab()).toHaveText(new RegExp(MULTI_SESSION_NAMES[1]));
        await expect
          .poll(async () => visibleTerminalRows().innerText(), { timeout: 10_000 })
          .toContain('M08_BRAVO_SESSION_STATE');
        expect(workspaceConnectIds).toHaveLength(3);
      });

      await step('scroll the overflowing tab strip and open its touch context menu', async () => {
        const tabScroller = page.getByTestId('terminal-tab-bar').locator('[class*="overflow-x-auto"]');
        await expect
          .poll(() => tabScroller.evaluate((element) => element.scrollWidth > element.clientWidth))
          .toBeTruthy();
        await tabScroller.hover();
        await page.mouse.wheel(0, 120);
        await expect.poll(() => tabScroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
        await tabScroller.evaluate((element) => {
          element.scrollLeft = 0;
        });

        const targetTab = tabForName(MULTI_SESSION_NAMES[1]).first();
        const box = await targetTab.boundingBox();
        expect(box).toBeTruthy();
        const point = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
        await targetTab.dispatchEvent('pointerdown', {
          pointerId: 1,
          pointerType: 'touch',
          isPrimary: true,
          button: 0,
          buttons: 1,
          clientX: point.x,
          clientY: point.y,
        });
        await page.waitForTimeout(650);
        await targetTab.dispatchEvent('pointerup', {
          pointerId: 1,
          pointerType: 'touch',
          isPrimary: true,
          button: 0,
          buttons: 0,
          clientX: point.x,
          clientY: point.y,
        });
        const menu = page.getByRole('menu');
        await expect(menu).toBeVisible();
        await expect(menu.getByRole('button', { name: 'Close Other Tabs', exact: true })).toBeVisible();
        await captureWorkspaceEvidence(page, testInfo, 'after');
        await menu.getByRole('button', { name: 'Close Other Tabs', exact: true }).click();
        await expect(tabs).toHaveCount(1);
        await expect(tabForName(MULTI_SESSION_NAMES[1])).toHaveAttribute('aria-selected', 'true');
      });

      await step('close the final tab and return to the real empty Workspace state', async () => {
        await tabForName(MULTI_SESSION_NAMES[1]).getByRole('button', { name: 'Close Tab', exact: true }).click();
        await expect(tabs).toHaveCount(0);
        await expect(page.getByTestId('workspace-connection-list')).toBeVisible();
        await expect(
          page
            .getByTestId('workspace-connection-list')
            .locator('[data-connection-id]')
            .filter({ hasText: MULTI_SESSION_NAMES[0] }),
        ).toBeVisible();
      });
    } finally {
      await setTestSshOnline(true);
      await removeMultiSessionConnections(context.request);
    }
  });
});
