import { expect, test, type APIRequestContext, type Locator, type Page, type Route } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  activeFileManagerList,
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  openConnectedFileManager,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { slowStep, step } from '../../support/steps';

const QUICK_COMMAND_NAME = 'E2E Wheel Scale Command';

async function recreateQuickCommand(request: APIRequestContext): Promise<number> {
  const list = await request.get('/api/v1/quick-commands');
  expect(list.ok()).toBeTruthy();
  const existing = (await list.json()) as Array<{ id: number; name?: string }>;
  for (const command of existing.filter((item) => item.name === QUICK_COMMAND_NAME)) {
    const remove = await request.delete(`/api/v1/quick-commands/${command.id}`);
    expect(remove.ok()).toBeTruthy();
  }

  const create = await request.post('/api/v1/quick-commands', {
    data: {
      name: QUICK_COMMAND_NAME,
      command: "printf 'WHEEL_SCALE_E2E\\n'",
      tagIds: [],
      variables: {},
    },
  });
  expect(create.status()).toBe(201);
  const body = (await create.json()) as { command: { id: number } };
  return body.command.id;
}

async function ctrlWheel(target: Locator, deltaY: number, count = 1): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await target.dispatchEvent('wheel', {
      ctrlKey: true,
      deltaY,
      deltaMode: 0,
    });
  }
}

const readScale = async (target: Locator, attribute: 'data-row-scale' | 'data-status-scale'): Promise<number> => {
  const value = await target.getAttribute(attribute);
  return Number(value);
};

async function holdFirstSettingsResponse(
  page: Page,
  key: string,
): Promise<{
  firstStarted: Promise<void>;
  secondStarted: Promise<void>;
  releaseFirst: () => void;
  dispose: () => Promise<void>;
}> {
  let firstStartedResolve!: () => void;
  let secondStartedResolve!: () => void;
  let releaseFirstResolve!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    firstStartedResolve = resolve;
  });
  const secondStarted = new Promise<void>((resolve) => {
    secondStartedResolve = resolve;
  });
  const releaseFirstPromise = new Promise<void>((resolve) => {
    releaseFirstResolve = resolve;
  });
  let matchingRequestCount = 0;

  const handler = async (route: Route) => {
    const request = route.request();
    if (request.method() !== 'PUT') {
      await route.continue();
      return;
    }
    let body: Record<string, unknown> = {};
    try {
      body = request.postDataJSON() as Record<string, unknown>;
    } catch {
      await route.continue();
      return;
    }
    if (!(key in body)) {
      await route.continue();
      return;
    }

    matchingRequestCount += 1;
    if (matchingRequestCount === 1) {
      const backendResponse = await route.fetch();
      firstStartedResolve();
      await releaseFirstPromise;
      await route.fulfill({ response: backendResponse });
      return;
    }

    if (matchingRequestCount === 2) secondStartedResolve();
    await route.continue();
  };

  await page.route('**/api/v1/settings', handler);
  return {
    firstStarted,
    secondStarted,
    releaseFirst: () => releaseFirstResolve(),
    dispose: async () => {
      releaseFirstResolve();
      await page.unroute('**/api/v1/settings', handler);
    },
  };
}

test('panel Ctrl+wheel scaling is stable, bounded, and responsive', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const settings = await context.request.put('/api/v1/settings', {
    data: {
      fileManagerRowSizeMultiplier: '1.0',
      fileManagerColWidths: JSON.stringify({ type: 50, name: 300, size: 100, permissions: 120, modified: 180 }),
      quickCommandRowSizeMultiplier: '1.0',
      statusMonitorScale: '1.0',
      showQuickCommandTags: 'false',
    },
  });
  expect(settings.ok()).toBeTruthy();

  await resetTestSshFilesystem();
  const quickCommandId = await recreateQuickCommand(context.request);
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  await slowStep('server status supports bounded Ctrl+wheel zoom without changing the pane footprint', async () => {
    const monitor = page.getByTestId('status-monitor').filter({ visible: true }).first();
    await expect(monitor).toBeVisible({ timeout: 20_000 });
    await expect(monitor).toContainText('CPU', { timeout: 20_000 });
    await expect(monitor).toHaveAttribute('data-status-scale', '1.00');

    const beforeBox = await monitor.boundingBox();
    expect(beforeBox).toBeTruthy();

    await ctrlWheel(monitor, -100);
    await expect.poll(() => readScale(monitor, 'data-status-scale')).toBeGreaterThanOrEqual(1.1);
    const afterBox = await monitor.boundingBox();
    expect(afterBox).toBeTruthy();
    expect(Math.abs(afterBox!.width - beforeBox!.width)).toBeLessThan(2);
    expect(Math.abs(afterBox!.height - beforeBox!.height)).toBeLessThan(2);

    await ctrlWheel(monitor, -100, 10);
    await expect.poll(() => readScale(monitor, 'data-status-scale')).toBe(1.6);
    await ctrlWheel(monitor, 100, 20);
    await expect.poll(() => readScale(monitor, 'data-status-scale')).toBe(0.65);

    await page.waitForTimeout(550);
    await expect(monitor).toHaveAttribute('data-status-scale', '0.65');
  });

  await step(
    'quick commands reacts noticeably to one wheel notch and does not bounce back after persistence',
    async () => {
      const quickView = page.getByTestId('quick-commands-view').filter({ visible: true }).first();
      await expect(quickView).toBeVisible({ timeout: 20_000 });
      const list = quickView.locator('.quick-command-list');
      const row = quickView.locator(`[data-command-id="${quickCommandId}"]`);
      await expect(row).toBeVisible({ timeout: 20_000 });
      await expect(list).toHaveAttribute('data-row-scale', '1.00');

      const beforeRowBox = await row.boundingBox();
      expect(beforeRowBox).toBeTruthy();
      await ctrlWheel(list, 100);
      await expect.poll(() => readScale(list, 'data-row-scale')).toBeLessThanOrEqual(0.9);
      const afterRowBox = await row.boundingBox();
      expect(afterRowBox).toBeTruthy();
      expect(beforeRowBox!.height - afterRowBox!.height).toBeGreaterThan(1);

      const scaleAfterWheel = await readScale(list, 'data-row-scale');
      await page.waitForTimeout(550);
      expect(await readScale(list, 'data-row-scale')).toBe(scaleAfterWheel);
    },
  );

  await slowStep('file manager keeps the Type column stable while repeatedly shrinking rows', async () => {
    await openConnectedFileManager(page);
    const list = activeFileManagerList(page);
    const typeHeader = page.getByTestId('file-manager-modal').getByTestId('file-manager-type-header');
    await expect(list).toHaveAttribute('data-row-scale', '1.00');
    await expect(typeHeader).toBeVisible();

    const typeHeaderLayout = await typeHeader.evaluate((element) => {
      const html = element as HTMLElement;
      const style = getComputedStyle(html);
      return {
        whiteSpace: style.whiteSpace,
        width: html.getBoundingClientRect().width,
        clientHeight: html.clientHeight,
        scrollHeight: html.scrollHeight,
      };
    });
    expect(typeHeaderLayout.whiteSpace).toBe('nowrap');
    expect(typeHeaderLayout.scrollHeight).toBeLessThanOrEqual(typeHeaderLayout.clientHeight + 1);

    const widths = [typeHeaderLayout.width];
    for (let index = 0; index < 5; index += 1) {
      await ctrlWheel(list, 100);
      widths.push((await typeHeader.boundingBox())!.width);
    }

    expect(await readScale(list, 'data-row-scale')).toBeLessThanOrEqual(0.6);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1.5);
    const finalHeaderLayout = await typeHeader.evaluate((element) => {
      const html = element as HTMLElement;
      return { clientHeight: html.clientHeight, scrollHeight: html.scrollHeight };
    });
    expect(finalHeaderLayout.scrollHeight).toBeLessThanOrEqual(finalHeaderLayout.clientHeight + 1);

    const scaleAfterWheel = await readScale(list, 'data-row-scale');
    await page.waitForTimeout(600);
    expect(await readScale(list, 'data-row-scale')).toBe(scaleAfterWheel);
  });
});

test('large Ctrl+wheel delta does not leak unused zoom steps into the next event', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const settings = await context.request.put('/api/v1/settings', {
    data: {
      quickCommandRowSizeMultiplier: '1.0',
      showQuickCommandTags: 'false',
    },
  });
  expect(settings.ok()).toBeTruthy();
  await resetTestSshFilesystem();
  const quickCommandId = await recreateQuickCommand(context.request);
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  const quickView = page.getByTestId('quick-commands-view').filter({ visible: true }).first();
  const list = quickView.locator('.quick-command-list');
  await expect(quickView.locator(`[data-command-id="${quickCommandId}"]`)).toBeVisible({ timeout: 20_000 });
  await expect(list).toHaveAttribute('data-row-scale', '1.00');

  await ctrlWheel(list, 640);
  await expect.poll(() => readScale(list, 'data-row-scale')).toBe(0.64);
  await ctrlWheel(list, 1);
  await page.waitForTimeout(100);
  expect(await readScale(list, 'data-row-scale')).toBe(0.64);
});

test('File Manager keeps the latest wheel scale when the sidebar is closed immediately', async ({ page, context }) => {
  test.setTimeout(60_000);
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const settings = await context.request.put('/api/v1/settings', {
    data: {
      fileManagerRowSizeMultiplier: '1.0',
      fileManagerColWidths: JSON.stringify({ type: 50, name: 300, size: 100, permissions: 120, modified: 180 }),
    },
  });
  expect(settings.ok()).toBeTruthy();
  const originalSidebarResponse = await context.request.get('/api/v1/settings/sidebar');
  expect(originalSidebarResponse.ok()).toBeTruthy();
  const originalSidebar = (await originalSidebarResponse.json()) as { left: string[]; right: string[] };
  const sidebarResponse = await context.request.put('/api/v1/settings/sidebar', {
    data: { left: originalSidebar.left, right: ['fileManager'] },
  });
  expect(sidebarResponse.ok()).toBeTruthy();

  try {
    await resetTestSshFilesystem();
    const connectionId = await ensureTestSshConnection(context.request);
    await connectTestSshFromConnectionsPage(page, connectionId);

    const sidebarToggle = page.getByTestId('sidebar-pane-fileManager');
    await sidebarToggle.click();
    const sidebar = page.getByTestId('right-sidebar-panel');
    const list = sidebar.getByTestId('file-manager-list');
    await expect(list).toBeVisible();
    await expect(list).toHaveAttribute('data-row-scale', '1.00');

    const persisted = page.waitForResponse(
      (response) => {
        if (!response.url().includes('/api/v1/settings') || response.request().method() !== 'PUT') return false;
        try {
          const body = response.request().postDataJSON() as Record<string, unknown>;
          return body.fileManagerRowSizeMultiplier === '0.92';
        } catch {
          return false;
        }
      },
      { timeout: 10_000 },
    );

    await ctrlWheel(list, 100);
    await expect.poll(() => readScale(list, 'data-row-scale')).toBe(0.92);
    // Close immediately, well before the normal 240ms debounce window expires.
    await sidebar.locator('button[title="Close Sidebar"]').click();
    expect((await persisted).ok()).toBeTruthy();

    await sidebarToggle.click();
    const reopenedList = sidebar.getByTestId('file-manager-list');
    await expect(reopenedList).toBeVisible();
    await expect(reopenedList).toHaveAttribute('data-row-scale', '0.92');
  } finally {
    await context.request.put('/api/v1/settings/sidebar', { data: originalSidebar });
  }
});

test('rapid panel scaling persists the newest value when save responses arrive out of order', async ({
  page,
  context,
}) => {
  test.setTimeout(75_000);
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const settings = await context.request.put('/api/v1/settings', {
    data: {
      fileManagerRowSizeMultiplier: '1.0',
      fileManagerColWidths: JSON.stringify({ type: 50, name: 300, size: 100, permissions: 120, modified: 180 }),
      quickCommandRowSizeMultiplier: '1.0',
      statusMonitorScale: '1.0',
      showQuickCommandTags: 'false',
    },
  });
  expect(settings.ok()).toBeTruthy();
  await resetTestSshFilesystem();
  const quickCommandId = await recreateQuickCommand(context.request);
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  await step('Quick Commands ignores the late response from the older scale save', async () => {
    const quickView = page.getByTestId('quick-commands-view').filter({ visible: true }).first();
    const list = quickView.locator('.quick-command-list');
    await expect(quickView.locator(`[data-command-id="${quickCommandId}"]`)).toBeVisible({ timeout: 20_000 });
    await expect(list).toHaveAttribute('data-row-scale', '1.00');

    const race = await holdFirstSettingsResponse(page, 'quickCommandRowSizeMultiplier');
    try {
      await ctrlWheel(list, 100);
      await race.firstStarted;
      const firstScale = await readScale(list, 'data-row-scale');
      await ctrlWheel(list, 100);
      const latestScale = await readScale(list, 'data-row-scale');
      expect(latestScale).toBeLessThan(firstScale);
      // Give the second debounce enough time to fire. Old code sends it concurrently;
      // the fixed saver intentionally keeps it queued until the first request settles.
      await page.waitForTimeout(350);
      race.releaseFirst();
      await race.secondStarted;
      await page.waitForTimeout(220);
      expect(await readScale(list, 'data-row-scale')).toBe(latestScale);
    } finally {
      await race.dispose();
    }
  });

  await step('Status Monitor ignores the late response from the older scale save', async () => {
    const monitor = page.getByTestId('status-monitor').filter({ visible: true }).first();
    await expect(monitor).toBeVisible();
    await expect(monitor).toHaveAttribute('data-status-scale', '1.00');

    const race = await holdFirstSettingsResponse(page, 'statusMonitorScale');
    try {
      await ctrlWheel(monitor, -100);
      await race.firstStarted;
      const firstScale = await readScale(monitor, 'data-status-scale');
      await ctrlWheel(monitor, -100);
      const latestScale = await readScale(monitor, 'data-status-scale');
      expect(latestScale).toBeGreaterThan(firstScale);
      await page.waitForTimeout(350);
      race.releaseFirst();
      await race.secondStarted;
      await page.waitForTimeout(220);
      expect(await readScale(monitor, 'data-status-scale')).toBe(latestScale);
    } finally {
      await race.dispose();
    }
  });

  await slowStep('File Manager ignores the late response from the older row-scale save', async () => {
    await openConnectedFileManager(page);
    const list = activeFileManagerList(page);
    await expect(list).toHaveAttribute('data-row-scale', '1.00');

    const race = await holdFirstSettingsResponse(page, 'fileManagerRowSizeMultiplier');
    try {
      await ctrlWheel(list, 100);
      await race.firstStarted;
      const firstScale = await readScale(list, 'data-row-scale');
      await ctrlWheel(list, 100);
      const latestScale = await readScale(list, 'data-row-scale');
      expect(latestScale).toBeLessThan(firstScale);
      await page.waitForTimeout(350);
      race.releaseFirst();
      await race.secondStarted;
      await page.waitForTimeout(220);
      expect(await readScale(list, 'data-row-scale')).toBe(latestScale);
    } finally {
      await race.dispose();
    }
  });
});
