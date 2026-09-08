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

  await step('new-session control still opens the connection picker on demand', async () => {
    await page.getByRole('button', { name: 'New Connection Tab', exact: true }).click();
    await expect(page.getByTestId('workspace-connection-list')).toBeVisible();
  });
});
