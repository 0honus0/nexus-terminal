import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';

for (const width of [393, 1440]) {
  test(`Workspace uses one connection and session start page at ${width}px`, async ({ page, context }) => {
    await loginAsInitialAdmin(context.request);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/workspace');
    const start = page.getByTestId('workspace-start-page');
    await expect(start).toBeVisible();
    await expect(start.getByTestId('workspace-connection-list')).toBeVisible();
    await expect(start.getByTestId('suspended-sessions-view')).toBeVisible();
    await expect(start).toHaveCSS('overflow-y', 'auto');
    await expect(start.locator('.session-list-container')).toHaveCSS('overflow-y', 'visible');
    await expect(start.locator('.workspace-connection-content')).toHaveCSS('overflow-y', 'visible');
    await page.getByRole('button', { name: 'New Connection Tab', exact: true }).click();
    await expect(page.getByTestId('workspace-start-page')).toHaveCount(1);
    await expect(page.getByTestId('workspace-suspended-toggle')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });
}
