import { expect, test, type APIRequestContext, type Locator } from '@playwright/test';
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
  const existing = await list.json() as Array<{ id: number; name?: string }>;
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
  const body = await create.json() as { command: { id: number } };
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

  await step('quick commands reacts noticeably to one wheel notch and does not bounce back after persistence', async () => {
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
  });

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
