import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

test('empty Workspace connection pane can be resized horizontally and keeps the saved width', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/workspace');

  const pane = page.getByTestId('no-session-connection-pane');
  const handle = page.getByTestId('no-session-connection-resize-handle');
  await expect(pane).toBeVisible();
  await expect(handle).toBeVisible();

  let resizedWidth = 0;
  await step('dragging the empty-state divider changes the connection pane width', async () => {
    const before = await pane.boundingBox();
    const handleBox = await handle.boundingBox();
    expect(before).toBeTruthy();
    expect(handleBox).toBeTruthy();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + Math.min(120, handleBox!.height / 2));
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + 120, handleBox!.y + Math.min(120, handleBox!.height / 2), { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => (await pane.boundingBox())?.width ?? 0).toBeGreaterThan(before!.width + 70);
    resizedWidth = (await pane.boundingBox())!.width;
  });

  await step('the resized width is persisted and restored after reload', async () => {
    await expect
      .poll(async () => {
        const response = await context.request.get('/api/v1/settings');
        if (!response.ok()) return 0;
        const settings = (await response.json()) as { sidebarPaneWidths?: Record<string, string> };
        return Number.parseFloat(settings.sidebarPaneWidths?.connections ?? '0');
      })
      .toBeGreaterThan(resizedWidth - 3);

    await page.reload({ waitUntil: 'domcontentloaded' });
    const reloadedPane = page.getByTestId('no-session-connection-pane');
    await expect(reloadedPane).toBeVisible();
    await expect
      .poll(async () => Math.abs(((await reloadedPane.boundingBox())?.width ?? 0) - resizedWidth))
      .toBeLessThan(3);
  });
});
