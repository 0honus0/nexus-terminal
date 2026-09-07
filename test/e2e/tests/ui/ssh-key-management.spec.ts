import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { configureSshE2eSettings, E2E_SSH } from '../../support/ssh';
import { step } from '../../support/steps';

const ORIGINAL_NAME = 'Z-E2EManagedSSHKeyWithAnExtremelyLongUnbrokenNameForNarrowMobile';
const EDITED_NAME = 'A-E2EManagedSSHKeyWithAnExtremelyLongUnbrokenNameForNarrowMobileEdited';
const SORT_PEER_NAME = 'M-E2EManagedSSHKeySortPeer';
const CONNECTION_NAME = 'E2E SSH Auth Switch';
const PRIVATE_KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nE2E-PRIVATE-KEY-CONTENT\n-----END OPENSSH PRIVATE KEY-----';

async function listKeys(request: APIRequestContext): Promise<Array<{ id: number; name: string }>> {
  const response = await request.get('/api/v1/ssh-keys');
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Array<{ id: number; name: string }>;
}

async function cleanupKeys(request: APIRequestContext): Promise<void> {
  for (const key of (await listKeys(request)).filter(
    (item) => item.name === ORIGINAL_NAME || item.name === EDITED_NAME || item.name === SORT_PEER_NAME,
  )) {
    const remove = await request.delete(`/api/v1/ssh-keys/${key.id}`);
    expect(remove.ok()).toBeTruthy();
  }
}

async function cleanupConnection(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/v1/connections');
  expect(response.ok()).toBeTruthy();
  const connections = (await response.json()) as Array<{ id: number; name?: string }>;
  for (const connection of connections.filter((item) => item.name === CONNECTION_NAME)) {
    expect((await request.delete(`/api/v1/connections/${connection.id}`)).ok()).toBeTruthy();
  }
}

test('SSH key management UI adds, renames without replacing private key, and deletes a key', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await cleanupKeys(context.request);
  await cleanupConnection(context.request);
  const peer = await context.request.post('/api/v1/ssh-keys', {
    data: { name: SORT_PEER_NAME, privateKey: PRIVATE_KEY, passphrase: null },
  });
  expect(peer.status()).toBe(201);
  await page.setViewportSize({ width: 320, height: 667 });

  await step('open SSH key manager from the connection authentication form', async () => {
    await page.goto('/connections');
    await page.getByTestId('connections-add-button').click();
    const connectionForm = page.getByTestId('connection-form');
    await expect(connectionForm).toBeVisible();
    await connectionForm.getByRole('button', { name: 'SSH Key', exact: true }).click();
    const selector = connectionForm.locator('#ssh-key-select');
    const manageButton = connectionForm.getByTestId('ssh-key-manage-button');
    for (const control of [selector, manageButton]) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    }
    await connectionForm.getByTestId('ssh-key-manage-button').click();
    const modal = page.getByTestId('ssh-key-management-modal');
    await expect(modal).toBeVisible();
    const dialog = page.getByRole('dialog').filter({ has: modal });
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(320);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(1);
  });

  let keyId = 0;
  await step('add a new key and persist encrypted credentials', async () => {
    const modal = page.getByTestId('ssh-key-management-modal');
    await modal.getByTestId('ssh-key-add').click();
    await modal.locator('#key-name').fill(ORIGINAL_NAME);
    await modal.locator('#key-private').fill(PRIVATE_KEY);
    await modal.getByTestId('ssh-key-submit').click();

    await expect
      .poll(async () => (await listKeys(context.request)).find((item) => item.name === ORIGINAL_NAME)?.id ?? 0, {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    keyId = (await listKeys(context.request)).find((item) => item.name === ORIGINAL_NAME)!.id;
    await expect(modal.locator(`tr[data-key-id="${keyId}"]`)).toContainText(ORIGINAL_NAME);
    const namesAfterCreate = await modal.locator('tbody tr[data-key-id] td:first-child').allTextContents();
    expect(namesAfterCreate.indexOf(SORT_PEER_NAME)).toBeGreaterThanOrEqual(0);
    expect(namesAfterCreate.indexOf(ORIGINAL_NAME)).toBeGreaterThan(namesAfterCreate.indexOf(SORT_PEER_NAME));
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(1);

    const details = await context.request.get(`/api/v1/ssh-keys/${keyId}/details`);
    expect(details.ok()).toBeTruthy();
    await expect(details.json()).resolves.toMatchObject({ name: ORIGINAL_NAME, privateKey: PRIVATE_KEY });
  });

  await step('edit allows a name-only change while the private key field stays empty', async () => {
    const modal = page.getByTestId('ssh-key-management-modal');
    const row = modal.locator(`tr[data-key-id="${keyId}"]`);
    await row.getByTestId('ssh-key-edit').click();
    await expect(modal.locator('#key-name')).toHaveValue(ORIGINAL_NAME);
    await expect(modal.locator('#key-private')).toHaveValue('');
    await expect(modal.locator('#key-private')).not.toHaveAttribute('required', '');
    await modal.locator('#key-name').fill(EDITED_NAME);
    await modal.getByTestId('ssh-key-submit').click();

    await expect
      .poll(async () => (await listKeys(context.request)).find((item) => item.id === keyId)?.name ?? '', {
        timeout: 15_000,
      })
      .toBe(EDITED_NAME);
    const details = await context.request.get(`/api/v1/ssh-keys/${keyId}/details`);
    expect(details.ok()).toBeTruthy();
    await expect(details.json()).resolves.toMatchObject({ name: EDITED_NAME, privateKey: PRIVATE_KEY });
    const namesAfterRename = await modal.locator('tbody tr[data-key-id] td:first-child').allTextContents();
    expect(namesAfterRename.indexOf(EDITED_NAME)).toBeGreaterThanOrEqual(0);
    expect(namesAfterRename.indexOf(EDITED_NAME)).toBeLessThan(namesAfterRename.indexOf(SORT_PEER_NAME));
  });

  let connectionId = 0;
  await step('connection authentication can switch from password to the saved key and back to password', async () => {
    const modal = page.getByTestId('ssh-key-management-modal');
    await modal.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(modal).toBeHidden();

    const form = page.getByTestId('connection-form');
    await expect(form).toBeVisible();
    await form.locator('#ssh-key-select').selectOption(String(keyId));
    await form.locator('#conn-name').fill(CONNECTION_NAME);
    await form.locator('#conn-host').fill(E2E_SSH.host);
    await form.locator('#conn-port').fill(String(E2E_SSH.port));
    await form.locator('#conn-username').fill(E2E_SSH.username);
    const createPromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/connections') && response.request().method() === 'POST',
    );
    await form.getByTestId('connection-submit-button').click();
    const create = await createPromise;
    expect(create.status()).toBe(201);
    connectionId = ((await create.json()) as { connection: { id: number } }).connection.id;
    await expect(form).toBeHidden({ timeout: 15_000 });

    const keyed = await context.request.get(`/api/v1/connections/${connectionId}`);
    expect(keyed.ok()).toBeTruthy();
    await expect(keyed.json()).resolves.toMatchObject({
      id: connectionId,
      name: CONNECTION_NAME,
      authMethod: 'key',
      sshKeyId: keyId,
    });

    const row = page.getByTestId(`connection-row-${connectionId}`);
    await row.getByTestId('connection-row-edit').click();
    await expect(form).toBeVisible();
    await form.getByRole('button', { name: 'Password', exact: true }).click();
    await form.locator('#conn-password').fill(E2E_SSH.password);
    const updatePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/v1/connections/${connectionId}`) && response.request().method() === 'PUT',
    );
    await form.getByTestId('connection-submit-button').click();
    expect((await updatePromise).ok()).toBeTruthy();
    await expect(form).toBeHidden({ timeout: 15_000 });

    const passwordBased = await context.request.get(`/api/v1/connections/${connectionId}`);
    expect(passwordBased.ok()).toBeTruthy();
    await expect(passwordBased.json()).resolves.toMatchObject({ authMethod: 'password', sshKeyId: null });
    const connectionTest = await context.request.post(`/api/v1/connections/${connectionId}/test`);
    expect(connectionTest.ok()).toBeTruthy();
    await expect(connectionTest.json()).resolves.toMatchObject({ success: true });
  });

  await step('delete failure is visible and preserves the key row', async () => {
    if (connectionId) {
      expect((await context.request.delete(`/api/v1/connections/${connectionId}`)).ok()).toBeTruthy();
      connectionId = 0;
    }
    await page.goto('/connections');
    await page.getByTestId('connections-add-button').click();
    const connectionForm = page.getByTestId('connection-form');
    await connectionForm.getByRole('button', { name: 'SSH Key', exact: true }).click();
    await connectionForm.getByTestId('ssh-key-manage-button').click();
    const modal = page.getByTestId('ssh-key-management-modal');
    const row = modal.locator(`tr[data-key-id="${keyId}"]`);
    await expect(row).toContainText(EDITED_NAME);
    await page.route(`**/api/v1/ssh-keys/${keyId}`, async (route) => {
      if (route.request().method() === 'DELETE') await route.abort('failed');
      else await route.continue();
    });
    await row.getByTestId('ssh-key-delete').click();
    const confirm = page.getByRole('dialog', { name: 'Please confirm' });
    await expect(confirm).toContainText(EDITED_NAME);
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(modal.getByTestId('ssh-key-list-error')).toContainText('Network Error');
    await expect(row).toBeVisible();
    await page.unroute(`**/api/v1/ssh-keys/${keyId}`);
  });

  await step('delete removes the key from UI and persistence', async () => {
    const modal = page.getByTestId('ssh-key-management-modal');
    const row = modal.locator(`tr[data-key-id="${keyId}"]`);
    await row.getByTestId('ssh-key-delete').click();
    const confirm = page.getByRole('dialog', { name: 'Please confirm' });
    await expect(confirm).toContainText(EDITED_NAME);
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect.poll(async () => (await listKeys(context.request)).some((item) => item.id === keyId)).toBeFalsy();
  });

  await cleanupConnection(context.request);
  await cleanupKeys(context.request);
});

test('SSH key selector and manager surface key-list loading failures without overflowing narrow screens', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await page.setViewportSize({ width: 320, height: 667 });
  await page.route('**/api/v1/ssh-keys', async (route) => route.abort('failed'));
  await page.goto('/connections');
  await page.getByTestId('connections-add-button').click();
  const form = page.getByTestId('connection-form');
  await form.getByRole('button', { name: 'SSH Key', exact: true }).click();
  await expect(form.getByTestId('ssh-key-selector-error')).toContainText('Network Error');
  await form.getByTestId('ssh-key-manage-button').click();
  const modal = page.getByTestId('ssh-key-management-modal');
  await expect(modal.getByTestId('ssh-key-list-error')).toContainText('Network Error');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(1);
});
