import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, configureSshE2eSettings, removeNamedSshConnections, resetTestSshFilesystem } from '../../support/ssh';
import { captureFunctionalScreenshot, functionalScreenshotsEnabled } from '../../support/functional-screenshots';
import { step, slowStep } from '../../support/steps';

test('adds, tests, and connects to a real SSH server', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  const embeddedWorkspaceSettings = await context.request.put('/api/v1/settings', {
    data: { showPopupFileManager: false, showPopupFileEditor: false },
  });
  expect(embeddedWorkspaceSettings.ok()).toBeTruthy();
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
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/connections/test-unsaved') && response.request().method() === 'POST',
    );
    await page.getByTestId('connection-test-button').click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });

  await step('save SSH connection', async () => {
    const createPromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/connections') && response.request().method() === 'POST',
    );
    await page.getByTestId('connection-submit-button').click();
    const response = await createPromise;
    expect(response.status()).toBe(201);
    await expect(page.getByText(E2E_SSH.name, { exact: true }).first()).toBeVisible();
  });

  await slowStep('open real SSH session and SFTP file manager', async () => {
    const delayResponse = await fetch(`${E2E_SSH.controlUrl}/sftp/readdir-delay?ms=1200`, { method: 'POST' });
    expect(delayResponse.ok).toBeTruthy();
    try {
      const row = page.getByText(E2E_SSH.name, { exact: true }).first().locator('xpath=ancestor::li');
      await row.getByRole('button', { name: 'Connect', exact: true }).click();
      await expect(page).toHaveURL(/\/workspace$/);

      const initialLoading = page.locator('[data-testid="file-manager-loading-state"]:visible');
      await expect(initialLoading).toHaveCount(1);
      await expect(page.locator('[data-testid="file-manager-list"]:visible')).toHaveCount(0);
      await expect(page.getByText('Directory is empty', { exact: true })).toHaveCount(0);
      await expect(page.locator('[data-testid="file-manager-list"]:visible tr[data-filename="seed.txt"]')).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      const resetDelay = await fetch(`${E2E_SSH.controlUrl}/sftp/readdir-delay?ms=0`, { method: 'POST' });
      expect(resetDelay.ok).toBeTruthy();
    }

    if (functionalScreenshotsEnabled()) {
      const terminal = page.getByTestId('terminal');
      const commandInput = page.getByTestId('command-input');
      await expect(terminal).toBeVisible({ timeout: 20_000 });
      await expect(commandInput).toBeEnabled({ timeout: 20_000 });
      const embeddedFileManager = page.locator('[data-testid="file-manager-list"]').filter({ visible: true });
      await expect(embeddedFileManager).toHaveCount(1);
      await expect(embeddedFileManager.locator('tr[data-filename="seed.txt"]')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('file-editor-view').filter({ visible: true })).toBeVisible();
      await commandInput.fill('clear');
      await commandInput.press('Enter');
      await commandInput.fill("printf 'Nexus Terminal documentation screenshot\\n'");
      await commandInput.press('Enter');
      await expect
        .poll(async () => terminal.locator('.xterm-rows').innerText(), { timeout: 15_000 })
        .toContain('Nexus Terminal documentation screenshot');
      await captureFunctionalScreenshot(page, 'ssh-terminal.png', { viewport: { width: 1440, height: 900 } });
    }

    const embeddedFileManager = page.locator('[data-testid="file-manager-list"]').filter({ visible: true });
    await expect(embeddedFileManager.locator('tr[data-filename="seed.txt"]')).toBeVisible({ timeout: 20_000 });
  });
});

test('Connect All waits for each Workspace binding before mounted file managers request SFTP', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();

  const prefix = `E2E Connect All Race ${Date.now()}`;
  const connectionIds: number[] = [];
  const protocolErrors: string[] = [];
  const createConnection = async (suffix: string): Promise<number> => {
    const response = await context.request.post('/api/v1/connections', {
      data: {
        name: `${prefix} ${suffix}`,
        type: 'SSH',
        host: E2E_SSH.host,
        port: E2E_SSH.port,
        username: E2E_SSH.username,
        authMethod: 'password',
        password: E2E_SSH.password,
      },
    });
    expect(response.status()).toBe(201);
    return ((await response.json()) as { connection: { id: number } }).connection.id;
  };

  try {
    connectionIds.push(await createConnection('A'), await createConnection('B'));
    page.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload }) => {
        if (typeof payload !== 'string') return;
        if (payload.includes('protocol.error') || payload.includes('Workspace session')) protocolErrors.push(payload);
      });
    });

    await page.goto('/connections');
    await page.getByTestId('connections-search').fill(prefix);
    await expect(page.locator('li[data-testid^="connection-row-"]')).toHaveCount(2);
    await page.getByRole('button', { name: 'Connect All', exact: true }).click();
    await expect(page).toHaveURL(/\/workspace$/);

    const tabs = page.getByTestId('terminal-tab-bar').getByRole('tab');
    await expect(tabs).toHaveCount(2, { timeout: 20_000 });
    await expect
      .poll(() => tabs.evaluateAll((items) => items.map((item) => item.getAttribute('data-session-state'))), {
        timeout: 40_000,
      })
      .toEqual(['connected', 'connected']);
    await expect
      .poll(() => tabs.evaluateAll((items) => items.map((item) => item.getAttribute('data-session-status') ?? '')))
      .toEqual(['', '']);
    expect(
      protocolErrors.filter((message) => message.includes('Workspace session') && message.includes('was not found')),
    ).toEqual([]);
  } finally {
    for (const id of connectionIds) {
      const response = await context.request.delete(`/api/v1/connections/${id}`);
      expect([200, 204, 404]).toContain(response.status());
    }
  }
});
