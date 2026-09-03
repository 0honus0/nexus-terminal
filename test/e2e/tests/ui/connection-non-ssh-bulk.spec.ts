import { expect, test, type APIRequestContext, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

const RDP_NAME = 'E2E NonSSH Batch RDP';
const VNC_NAME = 'E2E NonSSH Batch VNC';

async function cleanupConnections(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/v1/connections');
  expect(response.ok()).toBeTruthy();
  const connections = (await response.json()) as Array<{ id: number; name?: string }>;
  for (const connection of connections.filter((item) => [RDP_NAME, VNC_NAME].includes(item.name || ''))) {
    expect((await request.delete(`/api/v1/connections/${connection.id}`)).ok()).toBeTruthy();
  }
}

async function createNonSshConnection(
  page: Page,
  type: 'RDP' | 'VNC',
  name: string,
  host: string,
  port: number,
): Promise<number> {
  await page.getByTestId('connections-add-button').click();
  const form = page.getByTestId('connection-form');
  await expect(form).toBeVisible();
  await form.getByTestId(type === 'RDP' ? 'connection-type-rdp' : 'connection-type-vnc').click();
  await form.locator('#conn-name').fill(name);
  await form.locator('#conn-host').fill(host);
  await form.locator('#conn-port').fill(String(port));
  await form.locator('#conn-username').fill(`${type.toLowerCase()}-e2e-user`);
  const password = type === 'RDP' ? form.locator('#conn-password-rdp') : form.locator('#conn-password-vnc');
  await password.fill(`${type}-e2e-password`);
  await form.locator('#conn-notes').fill(`${type} created through conditional browser form`);

  const createPromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/connections') && response.request().method() === 'POST',
  );
  await form.getByTestId('connection-submit-button').click();
  const create = await createPromise;
  expect(create.status()).toBe(201);
  const id = ((await create.json()) as { connection: { id: number } }).connection.id;
  await expect(form).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId(`connection-row-${id}`)).toContainText(name);
  return id;
}

test('RDP and VNC form branches persist correctly and filtered batch selection deletes exactly the intended connections', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  expect((await context.request.put('/api/v1/settings', { data: { language: 'en-US' } })).ok()).toBeTruthy();
  await cleanupConnections(context.request);

  try {
    await page.goto('/connections');
    let rdpId = 0;
    let vncId = 0;

    await step('create RDP and VNC connections through their conditional form branches', async () => {
      rdpId = await createNonSshConnection(page, 'RDP', RDP_NAME, '192.0.2.41', 3389);
      vncId = await createNonSshConnection(page, 'VNC', VNC_NAME, '192.0.2.42', 5901);

      const rdp = await context.request.get(`/api/v1/connections/${rdpId}`);
      const vnc = await context.request.get(`/api/v1/connections/${vncId}`);
      expect(rdp.ok()).toBeTruthy();
      expect(vnc.ok()).toBeTruthy();
      await expect(rdp.json()).resolves.toMatchObject({
        id: rdpId,
        name: RDP_NAME,
        type: 'RDP',
        host: '192.0.2.41',
        port: 3389,
        username: 'rdp-e2e-user',
      });
      await expect(vnc.json()).resolves.toMatchObject({
        id: vncId,
        name: VNC_NAME,
        type: 'VNC',
        host: '192.0.2.42',
        port: 5901,
        username: 'vnc-e2e-user',
      });
    });

    await step(
      'select-all obeys the active filter and invert selection operates on the restored full list',
      async () => {
        await page.getByTestId('batch-edit-toggle').click();
        await expect(page.getByTestId('batch-edit-toggle')).toHaveAttribute('aria-checked', 'true');
        const search = page.getByTestId('connections-search');
        await search.fill(RDP_NAME);
        await expect(page.getByTestId(`connection-row-${rdpId}`)).toBeVisible();
        await expect(page.getByTestId(`connection-row-${vncId}`)).toHaveCount(0);

        await page.getByTestId('batch-select-all').click();
        await expect(page.getByTestId(`connection-row-${rdpId}`)).toHaveClass(/ring-2/);

        await search.fill('');
        await expect(page.getByTestId(`connection-row-${vncId}`)).toBeVisible();
        await page.getByTestId('batch-invert-selection').click();
        await expect(page.getByTestId(`connection-row-${rdpId}`)).not.toHaveClass(/ring-2/);
        await expect(page.getByTestId(`connection-row-${vncId}`)).toHaveClass(/ring-2/);
      },
    );

    await step(
      'deselect/select-all followed by batch delete removes both records from UI and persistence',
      async () => {
        await page.getByTestId('connections-search').fill('E2E NonSSH Batch ');
        await expect(page.getByTestId(`connection-row-${rdpId}`)).toBeVisible();
        await expect(page.getByTestId(`connection-row-${vncId}`)).toBeVisible();
        await page.getByTestId('batch-deselect-all').click();
        await expect(page.getByTestId('batch-delete-selected')).toBeDisabled();
        await page.getByTestId('batch-select-all').click();
        await expect(page.getByTestId('batch-delete-selected')).toBeEnabled();

        await page.getByTestId('batch-delete-selected').click();
        const confirm = page.getByRole('dialog').filter({ hasText: 'delete the selected 2 connections' });
        await expect(confirm).toBeVisible();
        await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();

        const success = page
          .getByRole('dialog')
          .filter({ hasText: 'Selected connections have been successfully deleted.' });
        await expect(success).toBeVisible({ timeout: 15_000 });
        await success.getByRole('button', { name: 'OK', exact: true }).click();
        await expect(page.getByTestId(`connection-row-${rdpId}`)).toHaveCount(0);
        await expect(page.getByTestId(`connection-row-${vncId}`)).toHaveCount(0);

        await expect
          .poll(async () => {
            const response = await context.request.get('/api/v1/connections');
            if (!response.ok()) return [RDP_NAME, VNC_NAME];
            const names = ((await response.json()) as Array<{ name?: string }>).map((item) => item.name);
            return [RDP_NAME, VNC_NAME].filter((name) => names.includes(name));
          })
          .toEqual([]);
      },
    );
  } finally {
    await cleanupConnections(context.request);
  }
});
