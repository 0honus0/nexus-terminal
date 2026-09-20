import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

test('empty desktop Workspace keeps the arch-style centered placeholder without a forced connection pane', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/workspace');

  await step('desktop empty state does not reserve a fixed connection sidebar', async () => {
    await expect(page.getByTestId('no-session-placeholder')).toBeVisible();
    await expect(page.getByTestId('no-session-connection-pane')).toHaveCount(0);
    await expect(page.getByTestId('workspace-connection-list')).toHaveCount(0);
  });

  await step('desktop tab bar and empty Workspace content share the same outer edges', async () => {
    const workspaceBox = await page.getByTestId('workspace-root').boundingBox();
    const tabBarBox = await page.getByTestId('terminal-tab-bar').boundingBox();
    const placeholderBox = await page.getByTestId('no-session-placeholder').boundingBox();
    expect(workspaceBox).toBeTruthy();
    expect(tabBarBox).toBeTruthy();
    expect(placeholderBox).toBeTruthy();
    expect(Math.abs(tabBarBox!.x - workspaceBox!.x - 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(workspaceBox!.x + workspaceBox!.width - tabBarBox!.x - tabBarBox!.width - 8)).toBeLessThanOrEqual(
      1,
    );
    expect(Math.abs(tabBarBox!.y - workspaceBox!.y - 8)).toBeLessThanOrEqual(1);
    expect(Math.abs(tabBarBox!.x - placeholderBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(tabBarBox!.x + tabBarBox!.width - (placeholderBox!.x + placeholderBox!.width))).toBeLessThanOrEqual(
      1,
    );
    expect(Math.abs(placeholderBox!.y - (tabBarBox!.y + tabBarBox!.height))).toBeLessThanOrEqual(1);
    expect(
      Math.abs(workspaceBox!.y + workspaceBox!.height - placeholderBox!.y - placeholderBox!.height - 8),
    ).toBeLessThanOrEqual(1);
  });

  await step('new-session control still opens the connection picker on demand', async () => {
    await page.getByRole('button', { name: 'New Connection Tab', exact: true }).click();
    await expect(page.getByTestId('workspace-connection-list')).toBeVisible();
  });
});
