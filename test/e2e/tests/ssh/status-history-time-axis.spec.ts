import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  resetTestSshFilesystem,
} from '../../support/ssh';

test('status history uses real 1/5/10/30 minute windows without stretching new-session samples', async ({
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

  const monitor = page.getByTestId('status-monitor').filter({ visible: true }).first();
  await expect(monitor).toBeVisible({ timeout: 20_000 });
  await expect(monitor.locator('.metric-cpu')).toBeVisible({ timeout: 20_000 });
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
});
