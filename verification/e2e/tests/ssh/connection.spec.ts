import { expect, test } from '@playwright/test';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  E2E_SSH,
  configureSshE2eSettings,
  removeNamedSshConnections,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { step, slowStep } from '../../support/steps';

test('adds, tests, and connects to a real SSH server', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  await removeNamedSshConnections(context.request);

  await step('open add SSH connection form', async () => {
    await page.goto('/connections');
    await page.getByTestId('connections-add-button').click();
    await expect(page.getByRole('heading', { name: 'Add New Connection' })).toBeVisible();
  });

  await step('fill SSH password connection', async () => {
    await page.locator('#conn-name').fill(E2E_SSH.name);
    await page.locator('#conn-host').fill(E2E_SSH.host);
    await page.locator('#conn-port').fill(String(E2E_SSH.port));
    await page.locator('#conn-username').fill(E2E_SSH.username);
    await page.locator('#conn-password').fill(E2E_SSH.password);
  });

  await step('test unsaved SSH connection against real server', async () => {
    const responsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/v1/connections/test-unsaved') && response.request().method() === 'POST',
    );
    await page.getByTestId('connection-test-button').click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });

  await step('save SSH connection', async () => {
    const createPromise = page.waitForResponse((response) =>
      response.url().endsWith('/api/v1/connections') && response.request().method() === 'POST',
    );
    await page.getByTestId('connection-submit-button').click();
    const response = await createPromise;
    expect(response.status()).toBe(201);
    await expect(page.getByText(E2E_SSH.name, { exact: true }).first()).toBeVisible();
  });

  await slowStep('open real SSH session and SFTP file manager', async () => {
    const row = page.getByText(E2E_SSH.name, { exact: true }).first().locator('xpath=ancestor::li');
    await row.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page).toHaveURL(/\/workspace$/);

    const fileManagerButton = page.getByTestId('open-file-manager-button');
    await expect(fileManagerButton).toBeVisible({ timeout: 20_000 });
    await fileManagerButton.click();
    await expect(page.locator('tr[data-filename="seed.txt"]')).toBeVisible({ timeout: 20_000 });
  });
});
