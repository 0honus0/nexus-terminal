import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

export const E2E_SSH = {
  name: 'E2E SSH',
  host: '127.0.0.1',
  port: 22222,
  username: 'e2e',
  password: 'e2e-password',
  controlUrl: 'http://127.0.0.1:22223',
} as const;

export async function configureSshE2eSettings(request: APIRequestContext): Promise<void> {
  const response = await request.put('/api/v1/settings', {
    data: {
      language: 'en-US',
      showPopupFileManager: 'true',
      showPopupFileEditor: 'true',
      fileManagerShowDeleteConfirmation: 'true',
    },
  });
  expect(response.ok()).toBeTruthy();
}

export async function resetTestSshFilesystem(): Promise<void> {
  const response = await fetch(`${E2E_SSH.controlUrl}/reset`, { method: 'POST' });
  expect(response.ok).toBeTruthy();
}

export async function setTestSshOnline(online: boolean): Promise<void> {
  const response = await fetch(`${E2E_SSH.controlUrl}/ssh/${online ? 'online' : 'offline'}`, { method: 'POST' });
  expect(response.ok).toBeTruthy();
}

export async function removeNamedSshConnections(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/v1/connections');
  expect(response.ok()).toBeTruthy();
  const connections = await response.json() as Array<{ id: number; name?: string }>;
  for (const connection of connections.filter((item) => item.name === E2E_SSH.name)) {
    const deleteResponse = await request.delete(`/api/v1/connections/${connection.id}`);
    expect(deleteResponse.ok()).toBeTruthy();
  }
}

export async function ensureTestSshConnection(request: APIRequestContext): Promise<number> {
  const listResponse = await request.get('/api/v1/connections');
  expect(listResponse.ok()).toBeTruthy();
  const existing = (await listResponse.json() as Array<{ id: number; name?: string }>).find((item) => item.name === E2E_SSH.name);
  if (existing) return existing.id;

  const createResponse = await request.post('/api/v1/connections', {
    data: {
      name: E2E_SSH.name,
      type: 'SSH',
      host: E2E_SSH.host,
      port: E2E_SSH.port,
      username: E2E_SSH.username,
      auth_method: 'password',
      password: E2E_SSH.password,
    },
  });
  expect(createResponse.status()).toBe(201);
  const body = await createResponse.json() as { connection: { id: number } };
  return body.connection.id;
}

export async function connectTestSshFromConnectionsPage(page: Page, connectionId: number): Promise<void> {
  await page.goto('/connections');
  const row = page.locator(`[data-connection-id="${connectionId}"]`);
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  // Reaching the workspace route only means the session UI was created. Wait until the
  // initial SSH handshake has completed so callers cannot race the product's intentional
  // command-input guard and silently lose their first terminal action.
  await expect(page.getByTestId('command-input')).toBeEnabled({ timeout: 20_000 });
}

export function activeFileManagerList(page: Page): Locator {
  return page.getByTestId('file-manager-modal').locator('[data-testid="file-manager-list"]');
}

export function fileManagerRow(page: Page, filename: string): Locator {
  return activeFileManagerList(page).locator(`tr[data-filename="${filename}"]`);
}

export async function openConnectedFileManager(page: Page): Promise<void> {
  const openButton = page.getByTestId('open-file-manager-button');
  await expect(openButton).toBeVisible({ timeout: 20_000 });
  await openButton.click();
  await expect(page.getByText('File Manager', { exact: false }).first()).toBeVisible();
  await expect(fileManagerRow(page, 'seed.txt')).toBeVisible({ timeout: 20_000 });
}

export async function closeConnectedFileManager(page: Page): Promise<void> {
  const modal = page.getByTestId('file-manager-modal');
  await expect(modal).toBeVisible();
  await modal.getByTestId('file-manager-modal-close').click();
  await expect(modal).toBeHidden();
}

export async function reopenConnectedFileManager(page: Page): Promise<void> {
  const openButton = page.getByTestId('open-file-manager-button');
  await expect(openButton).toBeVisible({ timeout: 20_000 });
  await openButton.click();
  const modal = page.getByTestId('file-manager-modal');
  await expect(modal).toBeVisible();
  await expect(activeFileManagerList(page)).toBeVisible({ timeout: 20_000 });
}


export async function openInlineProgressDisplay(page: Page): Promise<Locator> {
  const fileManagerModal = page.getByTestId('file-manager-modal');
  if (await fileManagerModal.isVisible()) {
    await closeConnectedFileManager(page);
  }

  const toggle = page.getByTestId('transfer-progress-toggle');
  await expect(toggle).toBeVisible();
  await toggle.click();

  const display = page.getByTestId('progress-display-modal');
  await expect(display).toBeVisible();
  await expect(display).toHaveAttribute('data-progress-display-placement', 'inline');
  await expect.poll(() => display.evaluate(element => ({
    position: window.getComputedStyle(element).position,
    zIndex: window.getComputedStyle(element).zIndex,
  }))).toEqual({ position: 'static', zIndex: 'auto' });
  return display;
}
