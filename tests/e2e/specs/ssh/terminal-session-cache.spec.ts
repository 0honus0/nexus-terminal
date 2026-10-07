import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../support/fixtures';
import { E2E_SSH, configureSshE2eSettings, connectTestSshFromConnectionsPage } from '../../support/ssh';
import { loginAsInitialAdmin } from '../../support/auth';

test('session switches retain terminal and background instances and skip unchanged resize frames', async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(60_000);
  const resizeFrames: unknown[] = [];
  page.on('websocket', (socket) =>
    socket.on('framesent', ({ payload }) => {
      if (typeof payload === 'string') {
        const frame = JSON.parse(payload);
        if (frame.type === 'terminal.resize') resizeFrames.push(frame);
      }
    }),
  );
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  expect(
    (
      await context.request.put('/api/v1/appearance', {
        data: {
          terminalBackgroundEnabled: true,
          terminalCustomHtml: `<canvas id="scene"></canvas><script>
        const canvas = document.getElementById('scene');
        canvas.dataset.instance = String(Math.random());
        let frames = 0;
        function paint() { canvas.dataset.frames = String(++frames); requestAnimationFrame(paint); }
        requestAnimationFrame(paint);
      </script>`,
        },
      })
    ).ok(),
  ).toBeTruthy();
  const ids: number[] = [];
  for (let index = 0; index < 3; index++) {
    const created = await context.request.post('/api/v1/connections', {
      data: {
        name: `E2E Cached Tab ${index}`,
        type: 'SSH',
        host: E2E_SSH.host,
        port: E2E_SSH.port,
        username: E2E_SSH.username,
        authMethod: 'password',
        password: E2E_SSH.password,
      },
    });
    expect(created.status()).toBe(201);
    ids.push((await created.json()).connection.id);
  }
  await connectTestSshFromConnectionsPage(page, ids[0]!);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const heapBytes = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = await cdp.send('Performance.getMetrics');
    return metrics.find((metric: { name: string }) => metric.name === 'JSHeapUsedSize')!.value;
  };
  await expect(page.frameLocator('.terminal-custom-html').locator('#scene')).toHaveAttribute('data-instance', /.+/);
  const oneSessionHeap = await heapBytes();
  for (const id of ids.slice(1)) {
    await page.getByRole('button', { name: 'New Connection Tab', exact: true }).click();
    await page.locator(`.workspace-connection-list [data-connection-id="${id}"]`).click();
    await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('data-session-state', 'connected', {
      timeout: 35_000,
    });
    await expect(page.locator('.command-bar-command-input:visible')).toBeEnabled();
  }
  const terminals = page.locator('.terminal-inner-container');
  const backgrounds = page.locator('.terminal-custom-html');
  await expect(terminals).toHaveCount(3);
  await expect(backgrounds).toHaveCount(3);
  const terminalNodes = await terminals.elementHandles();
  const backgroundNodes = await backgrounds.elementHandles();
  const instances: string[] = [];
  for (let index = 0; index < 3; index++) {
    const canvas = backgrounds.nth(index).contentFrame().locator('#scene');
    await expect(canvas).toHaveAttribute('data-instance', /.+/);
    instances.push((await canvas.getAttribute('data-instance'))!);
  }
  const threeSessionHeap = await heapBytes();
  await page.waitForTimeout(250);
  resizeFrames.length = 0;
  const timings: number[] = [];
  for (const index of [0, 1, 2, 0, 2, 1, 0, 1, 2]) {
    const tab = page.getByRole('tab').filter({ hasText: `E2E Cached Tab ${index}` });
    await tab.evaluate((element) => {
      element.addEventListener(
        'click',
        () => {
          element.setAttribute('data-switch-start', String(performance.now()));
        },
        { once: true },
      );
    });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(terminals.nth(index)).toBeVisible();
    const canvas = backgrounds.nth(index).contentFrame().locator('#scene');
    await expect(backgrounds.nth(index)).toBeVisible();
    await expect(canvas).toHaveAttribute('data-instance', instances[index]!);
    expect(await terminals.nth(index).evaluate((element, saved) => element === saved, terminalNodes[index]!)).toBe(
      true,
    );
    expect(await backgrounds.nth(index).evaluate((element, saved) => element === saved, backgroundNodes[index]!)).toBe(
      true,
    );
    timings.push(
      await tab.evaluate((element) => performance.now() - Number(element.getAttribute('data-switch-start'))),
    );
  }
  await page.waitForTimeout(200);
  expect(resizeFrames).toEqual([]);
  const hidden = backgrounds.nth(0).contentFrame().locator('#scene');
  await page.waitForTimeout(100);
  const pausedFrames = await hidden.getAttribute('data-frames');
  await page.waitForTimeout(200);
  await expect(hidden).toHaveAttribute('data-frames', pausedFrames!);
  const metrics = {
    sessions: 3,
    simpleBackground: true,
    oneSessionHeapMiB: oneSessionHeap / 1024 ** 2,
    threeSessionHeapMiB: threeSessionHeap / 1024 ** 2,
    averageSwitchCheckMs: timings.reduce((sum, time) => sum + time, 0) / timings.length,
    maximumSwitchCheckMs: Math.max(...timings),
    redundantResizeFrames: resizeFrames.length,
  };
  await writeFile(testInfo.outputPath('session-cache-metrics.json'), JSON.stringify(metrics, null, 2));
});
