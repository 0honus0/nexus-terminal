import { expect, test, type APIRequestContext } from '../../support/fixtures';
import type { Response } from '@playwright/test';
import { loginAsInitialAdmin } from '../../support/auth';
import { configureSshE2eSettings, E2E_SSH } from '../../support/ssh';
import { slowStep, step } from '../../support/steps';

const FORM_NAME = 'E2E UI Created SSH';
const SCRIPT_NAME_ONE = 'E2E Script SSH One';
const SCRIPT_NAME_TWO = 'E2E Script SSH Two';
const SCRIPT_TAG = 'E2E Script Imported Tag';

async function cleanupConnections(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/v1/connections');
  expect(response.ok()).toBeTruthy();
  const connections = (await response.json()) as Array<{ id: number; name?: string }>;
  for (const connection of connections.filter((item) =>
    [FORM_NAME, SCRIPT_NAME_ONE, SCRIPT_NAME_TWO].includes(item.name || ''),
  )) {
    expect((await request.delete(`/api/v1/connections/${connection.id}`)).ok()).toBeTruthy();
  }

  const tagsResponse = await request.get('/api/v1/tags');
  expect(tagsResponse.ok()).toBeTruthy();
  const tags = (await tagsResponse.json()) as Array<{ id: number; name: string }>;
  for (const tag of tags.filter((item) => item.name === SCRIPT_TAG)) {
    expect((await request.delete(`/api/v1/tags/${tag.id}`)).ok()).toBeTruthy();
  }
}

test.beforeEach(async ({ context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await cleanupConnections(context.request);
});

test.afterEach(async ({ context }) => {
  await cleanupConnections(context.request);
});

test('regular connection form tests and creates a persisted working SSH connection', async ({ page, context }) => {
  await page.goto('/connections');
  await page.getByTestId('connections-add-button').click();
  const form = page.getByTestId('connection-form');
  await expect(form).toBeVisible();

  await form.locator('#conn-name').fill(FORM_NAME);
  await form.locator('#conn-host').fill(E2E_SSH.host);
  await form.locator('#conn-port').fill(String(E2E_SSH.port));
  await form.locator('#conn-username').fill(E2E_SSH.username);
  await form.locator('#conn-password').fill(E2E_SSH.password);
  await form.locator('#conn-notes').fill('created through the browser form');

  await slowStep('test the unsaved connection against the real SSH fixture', async () => {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/connections/test-unsaved') && response.request().method() === 'POST',
    );
    await form.getByTestId('connection-test-button').click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });

  let connectionId = 0;
  await step('submit persists the connection and refreshes the visible list', async () => {
    const createPromise = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/connections') && response.request().method() === 'POST',
    );
    await form.getByTestId('connection-submit-button').click();
    const create = await createPromise;
    expect(create.status()).toBe(201);
    connectionId = ((await create.json()) as { connection: { id: number } }).connection.id;
    await expect(form).toBeHidden({ timeout: 15_000 });
    const row = page.getByTestId(`connection-row-${connectionId}`);
    await expect(row).toContainText(FORM_NAME);
    await expect(row).toContainText('created through the browser form');
  });

  await slowStep('the saved connection still authenticates with its stored credential', async () => {
    const testResponse = await context.request.post(`/api/v1/connections/${connectionId}/test`);
    expect(testResponse.ok()).toBeTruthy();
    await expect(testResponse.json()).resolves.toMatchObject({ success: true });
  });
});

test('script mode creates multiple connections, resolves tags, and preserves notes', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await page.goto('/connections');
  await page.getByTestId('connections-add-button').click();
  const form = page.getByTestId('connection-form');
  await expect(form).toBeVisible();

  const scriptToggle = form.getByRole('switch', { name: 'Script Mode', exact: true });
  await scriptToggle.click();
  await expect(scriptToggle).toHaveAttribute('aria-checked', 'true');
  const scriptInput = form.locator('#conn-script-input');
  await expect(scriptInput).toBeVisible();
  await scriptInput.fill(
    [
      `${E2E_SSH.username}@${E2E_SSH.host}:${E2E_SSH.port} -name "${SCRIPT_NAME_ONE}" -p "${E2E_SSH.password}" -tags "${SCRIPT_TAG}" -note "script first note"`,
      `${E2E_SSH.username}@${E2E_SSH.host}:${E2E_SSH.port} -name "${SCRIPT_NAME_TWO}" -p "${E2E_SSH.password}" -tags "${SCRIPT_TAG}" -note "script second note"`,
    ].join('\n'),
  );

  await step('one script submission creates both connections', async () => {
    let createCount = 0;
    const countCreates = (response: Response) => {
      if (
        response.url().endsWith('/api/v1/connections') &&
        response.request().method() === 'POST' &&
        response.status() === 201
      ) {
        createCount += 1;
      }
    };
    page.on('response', countCreates);
    await form.getByTestId('connection-submit-button').click();
    await expect.poll(() => createCount, { timeout: 15_000 }).toBe(2);
    page.off('response', countCreates);
    await expect(form).toBeHidden({ timeout: 15_000 });
  });

  const connectionsResponse = await context.request.get('/api/v1/connections');
  expect(connectionsResponse.ok()).toBeTruthy();
  const connections = (
    (await connectionsResponse.json()) as Array<{
      id: number;
      name: string;
      notes?: string;
      tagIds?: number[];
    }>
  ).filter((item) => item.name === SCRIPT_NAME_ONE || item.name === SCRIPT_NAME_TWO);
  expect(connections).toHaveLength(2);
  expect(connections.find((item) => item.name === SCRIPT_NAME_ONE)?.notes).toBe('script first note');
  expect(connections.find((item) => item.name === SCRIPT_NAME_TWO)?.notes).toBe('script second note');

  const tagsResponse = await context.request.get('/api/v1/tags');
  expect(tagsResponse.ok()).toBeTruthy();
  const tags = (await tagsResponse.json()) as Array<{ id: number; name: string }>;
  const createdTag = tags.find((tag) => tag.name === SCRIPT_TAG);
  expect(createdTag).toBeTruthy();
  for (const connection of connections) expect(connection.tagIds).toContain(createdTag!.id);

  for (const connection of connections) {
    const testResponse = await context.request.post(`/api/v1/connections/${connection.id}/test`);
    expect(testResponse.ok()).toBeTruthy();
    await expect(testResponse.json()).resolves.toMatchObject({ success: true });
  }
});
