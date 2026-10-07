import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
} from '../../support/ssh';

test('status history uses real time windows and keeps controls fixed and axes sharp while zooming', async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const settings = await context.request.put('/api/v1/settings', {
    data: { statusMonitorScale: 1, showStatusMonitorIpAddress: true },
  });
  expect(settings.ok()).toBeTruthy();
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  const monitor = page.locator('.status-monitor:visible').first();
  await expect(monitor).toBeVisible({ timeout: 20_000 });
  await expect(monitor.locator('.metric-cpu')).toBeVisible({ timeout: 20_000 });
  await monitor.locator('.metric-cpu').hover();
  await page.waitForTimeout(350);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await monitor.locator('.metric-cpu').click();

  const history = monitor.locator('.history-card');
  const chart = history.locator('.status-history-chart');
  await expect(history).toBeVisible();
  await expect(history.locator('.range-tabs button')).toHaveCount(4);
  await expect.poll(async () => Number(await chart.getAttribute('data-visible-start'))).toBeGreaterThan(0);

  for (const range of [1, 5, 10, 30] as const) {
    const rangeButton = history.getByRole('button', { name: `${range}m`, exact: true });
    await expect(rangeButton).toBeVisible();
    await rangeButton.click();
    await expect(chart).toHaveAttribute('data-range-minutes', String(range));

    const sampleWindow = await chart.evaluate((element) => ({
      start: Number(element.getAttribute('data-window-start')),
      end: Number(element.getAttribute('data-window-end')),
      first: Number(element.getAttribute('data-visible-start')),
    }));
    expect(sampleWindow.end - sampleWindow.start).toBe(range * 60_000);
    expect(sampleWindow.first).toBeGreaterThan(sampleWindow.start);
    if (range === 1) expect(sampleWindow.first - sampleWindow.start).toBeGreaterThan(20_000);
    if (range === 30) expect(sampleWindow.first - sampleWindow.start).toBeGreaterThan(20 * 60_000);
  }

  // Controls keep a fixed font and the canvas has enough pixels for CSS zoom.
  await monitor.evaluate((element) => {
    Object.assign((element as HTMLElement).style, {
      position: 'fixed',
      top: '40px',
      left: '40px',
      width: '480px',
      height: '600px',
      zIndex: '1000',
    });
  });
  const canvas = chart.locator('canvas');
  const tooltip = page.getByRole('tooltip');
  for (const [scale, deltaY, count] of [
    [1, 0, 0],
    [1.6, -100, 10],
    [0.65, 100, 20],
  ] as const) {
    await page.mouse.move(1100, 800);
    for (let index = 0; index < count; index += 1) {
      await monitor.dispatchEvent('wheel', { ctrlKey: true, deltaY, deltaMode: 0 });
    }
    await expect(monitor).toHaveAttribute('data-status-scale', scale.toFixed(2));
    await expect
      .poll(() =>
        canvas.evaluate((element) => {
          const canvas = element as HTMLCanvasElement;
          const rect = canvas.getBoundingClientRect();
          return Math.min(canvas.width / rect.width, canvas.height / rect.height) / window.devicePixelRatio;
        }),
      )
      .toBeGreaterThanOrEqual(0.99);
    for (const range of [1, 5, 10, 30]) {
      const button = history.getByRole('button', { name: `${range}m`, exact: true });
      await button.click();
      await expect(chart).toHaveAttribute('data-range-minutes', String(range));
      const fontSize = await button.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
      expect(fontSize * scale).toBeCloseTo(12, 1);
    }
    await canvas.hover({ position: { x: 200, y: 30 } });
    await page.waitForTimeout(350);
    await expect(tooltip).toHaveCount(0);
    await page.mouse.move(1100, 800);
    await monitor.locator('.network-card').click();
    const legend = page.locator('.network-legend');
    await expect(legend).toBeVisible();
    await expect(legend).toHaveCSS('font-size', '12px');
    expect(await legend.evaluate((element) => element.parentElement === document.body)).toBe(true);
    const legendBox = (await legend.boundingBox())!;
    const chartBox = (await chart.boundingBox())!;
    expect(legendBox.x).toBeGreaterThanOrEqual(chartBox.x);
    expect(legendBox.x + legendBox.width).toBeLessThanOrEqual(chartBox.x + chartBox.width);
    expect(Math.abs(legendBox.y - chartBox.y - 4)).toBeLessThan(1);
    await monitor.locator('.metric-cpu').click();
  }
  await monitor.locator('.network-card').click();
  await canvas.hover({ position: { x: 200, y: 30 } });
  await page.waitForTimeout(350);
  await expect(tooltip).toHaveCount(0);
  await history.locator('.history-close').click();
  await expect(tooltip).toHaveCount(0);
});
