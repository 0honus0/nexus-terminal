import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { configureSshE2eSettings } from '../../support/ssh';
import { step } from '../../support/steps';

const ORIGINAL_NAME = 'E2E Managed SSH Key';
const EDITED_NAME = 'E2E Managed SSH Key Edited';
const PRIVATE_KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nE2E-PRIVATE-KEY-CONTENT\n-----END OPENSSH PRIVATE KEY-----';

async function listKeys(request: APIRequestContext): Promise<Array<{ id: number; name: string }>> {
  const response = await request.get('/api/v1/ssh-keys');
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Array<{ id: number; name: string }>;
}

async function cleanupKeys(request: APIRequestContext): Promise<void> {
  for (const key of (await listKeys(request)).filter(
    (item) => item.name === ORIGINAL_NAME || item.name === EDITED_NAME,
  )) {
    const remove = await request.delete(`/api/v1/ssh-keys/${key.id}`);
    expect(remove.ok()).toBeTruthy();
  }
}

test('SSH key management UI adds, renames without replacing private key, and deletes a key', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await cleanupKeys(context.request);

  await step('open SSH key manager from the connection authentication form', async () => {
    await page.goto('/connections');
    await page.getByTestId('connections-add-button').click();
    const connectionForm = page.getByTestId('connection-form');
    await expect(connectionForm).toBeVisible();
    await connectionForm.getByRole('button', { name: 'SSH Key', exact: true }).click();
    await connectionForm.getByTestId('ssh-key-manage-button').click();
    await expect(page.getByTestId('ssh-key-management-modal')).toBeVisible();
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
  });

  await step('delete removes the key from UI and persistence', async () => {
    const modal = page.getByTestId('ssh-key-management-modal');
    const row = modal.locator(`tr[data-key-id="${keyId}"]`);
    await expect(row).toContainText(EDITED_NAME);
    await row.getByTestId('ssh-key-delete').click();
    const confirm = page.getByRole('dialog').filter({ hasText: EDITED_NAME });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect.poll(async () => (await listKeys(context.request)).some((item) => item.id === keyId)).toBeFalsy();
  });
});
