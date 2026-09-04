import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, resetTestSshFilesystem } from '../../support/ssh';
import { step } from '../../support/steps';

test('connection update, tags, clone, credentials, and delete form a complete lifecycle', async ({ request }) => {
  await loginAsInitialAdmin(request);

  let connectionId = 0;
  let cloneId = 0;
  let tagId = 0;

  await step('create a tagged SSH connection', async () => {
    const tag = await request.post('/api/v1/tags', { data: { name: 'E2E Connection Tag' } });
    expect(tag.status()).toBe(201);
    tagId = ((await tag.json()) as { tag: { id: number } }).tag.id;

    const create = await request.post('/api/v1/connections', {
      data: {
        name: 'E2E Lifecycle SSH',
        type: 'SSH',
        host: E2E_SSH.host,
        port: E2E_SSH.port,
        username: E2E_SSH.username,
        authMethod: 'password',
        password: E2E_SSH.password,
        notes: 'created by lifecycle e2e',
      },
    });
    expect(create.status()).toBe(201);
    connectionId = ((await create.json()) as { connection: { id: number } }).connection.id;

    const assignTag = await request.post('/api/v1/connections/add-tag', {
      data: { connectionIds: [connectionId], tagId: tagId },
    });
    expect(assignTag.ok()).toBeTruthy();
  });

  await step('update non-credential fields without losing the encrypted password', async () => {
    const update = await request.put(`/api/v1/connections/${connectionId}`, {
      data: {
        name: 'E2E Lifecycle SSH Updated',
        notes: 'updated without resending password',
      },
    });
    expect(update.ok()).toBeTruthy();
    await expect(update.json()).resolves.toMatchObject({
      connection: {
        id: connectionId,
        name: 'E2E Lifecycle SSH Updated',
        notes: 'updated without resending password',
      },
    });

    const connectionTest = await request.post(`/api/v1/connections/${connectionId}/test`);
    expect(connectionTest.ok()).toBeTruthy();
    await expect(connectionTest.json()).resolves.toMatchObject({ success: true });
  });

  await step('clone preserves SSH credentials and tag associations', async () => {
    const clone = await request.post(`/api/v1/connections/${connectionId}/clone`, {
      data: { name: 'E2E Lifecycle SSH Clone' },
    });
    expect(clone.status()).toBe(201);
    const cloned = (
      (await clone.json()) as {
        connection: { id: number; name: string; tagIds?: number[] };
      }
    ).connection;
    cloneId = cloned.id;
    expect(cloned.name).toBe('E2E Lifecycle SSH Clone');
    expect(cloned.tagIds).toContain(tagId);

    const cloneTest = await request.post(`/api/v1/connections/${cloneId}/test`);
    expect(cloneTest.ok()).toBeTruthy();
    await expect(cloneTest.json()).resolves.toMatchObject({ success: true });
  });

  await step('deleting the original does not damage the clone', async () => {
    expect((await request.delete(`/api/v1/connections/${connectionId}`)).ok()).toBeTruthy();
    expect((await request.get(`/api/v1/connections/${connectionId}`)).status()).toBe(404);

    const clone = await request.get(`/api/v1/connections/${cloneId}`);
    expect(clone.ok()).toBeTruthy();
    await expect(clone.json()).resolves.toMatchObject({
      id: cloneId,
      name: 'E2E Lifecycle SSH Clone',
    });
    expect((await request.post(`/api/v1/connections/${cloneId}/test`)).ok()).toBeTruthy();
  });

  await step('cleanup clone and tag', async () => {
    expect((await request.delete(`/api/v1/connections/${cloneId}`)).ok()).toBeTruthy();
    expect((await request.delete(`/api/v1/tags/${tagId}`)).ok()).toBeTruthy();
  });
});

test('new SSH connections appear in resource status immediately', async ({ request }) => {
  await loginAsInitialAdmin(request);

  const connectionName = 'E2E SSH Resource Cache Invalidation';
  const host = E2E_SSH.host;
  const port = E2E_SSH.port;
  let connectionId = 0;

  const existingConnections = await request.get('/api/v1/connections');
  expect(existingConnections.ok()).toBeTruthy();
  const existing = (await existingConnections.json()) as Array<{ id: number; name?: string }>;
  for (const connection of existing.filter((item) => item.name === connectionName)) {
    expect((await request.delete(`/api/v1/connections/${connection.id}`)).ok()).toBeTruthy();
  }

  try {
    await step('prime the snapshot cache before adding a new SSH host', async () => {
      const primed = await request.get('/api/v1/system/ssh-resources');
      expect(primed.ok()).toBeTruthy();
      const resources = (await primed.json()) as Array<{ host: string; port: number }>;
      expect(resources.some((resource) => resource.host === host && resource.port === port)).toBeFalsy();
    });

    await step('newly configured host bypasses the old snapshot cache immediately', async () => {
      const create = await request.post('/api/v1/connections', {
        data: {
          name: connectionName,
          type: 'SSH',
          host,
          port,
          username: E2E_SSH.username,
          authMethod: 'password',
          password: E2E_SSH.password,
        },
      });
      expect(create.status()).toBe(201);
      connectionId = ((await create.json()) as { connection: { id: number } }).connection.id;

      const refreshed = await request.get('/api/v1/system/ssh-resources');
      expect(refreshed.ok()).toBeTruthy();
      const resources = (await refreshed.json()) as Array<{
        connectionId: number;
        host: string;
        port: number;
        status?: { cpuPercent: number };
      }>;
      const resource = resources.find((item) => item.host === host && item.port === port);
      expect(resource).toBeDefined();
      expect(resource?.connectionId).toBe(connectionId);
      expect(resource?.status?.cpuPercent).toBeGreaterThanOrEqual(0);
    });
  } finally {
    if (connectionId) {
      expect((await request.delete(`/api/v1/connections/${connectionId}`)).ok()).toBeTruthy();
    }
  }
});

test('SSH resource status refreshes at the configured cadence even when collection takes time', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();

  const connectionName = 'E2E SSH Resource Refresh Cadence';
  const originalSettingsResponse = await request.get('/api/v1/settings');
  expect(originalSettingsResponse.ok()).toBeTruthy();
  const originalSettings = (await originalSettingsResponse.json()) as { remoteHostRefreshIntervalSeconds?: number };

  const existingConnections = await request.get('/api/v1/connections');
  expect(existingConnections.ok()).toBeTruthy();
  const existing = (await existingConnections.json()) as Array<{ id: number; name?: string }>;
  for (const connection of existing.filter((item) => item.name === connectionName)) {
    expect((await request.delete(`/api/v1/connections/${connection.id}`)).ok()).toBeTruthy();
  }

  let connectionId = 0;
  try {
    const create = await request.post('/api/v1/connections', {
      data: {
        name: connectionName,
        type: 'SSH',
        host: E2E_SSH.host,
        port: E2E_SSH.port,
        username: E2E_SSH.username,
        authMethod: 'password',
        password: E2E_SSH.password,
      },
    });
    expect(create.status()).toBe(201);
    connectionId = ((await create.json()) as { connection: { id: number } }).connection.id;

    const intervalUpdate = await request.put('/api/v1/settings', {
      data: { remoteHostRefreshIntervalSeconds: 2 },
    });
    expect(intervalUpdate.ok()).toBeTruthy();

    const firstStartedAt = Date.now();
    const firstResponse = await request.get('/api/v1/system/ssh-resources');
    expect(firstResponse.ok()).toBeTruthy();
    const firstDurationMs = Date.now() - firstStartedAt;
    expect(firstDurationMs).toBeGreaterThan(50);
    const firstResources = (await firstResponse.json()) as Array<{ host: string; port: number; checkedAt: number }>;
    const firstResource = firstResources.find((item) => item.host === E2E_SSH.host && item.port === E2E_SSH.port);
    expect(firstResource).toBeDefined();

    const targetElapsedMs = 2050;
    const remainingMs = Math.max(0, targetElapsedMs - (Date.now() - firstStartedAt));
    if (remainingMs > 0) await new Promise((resolve) => setTimeout(resolve, remainingMs));

    const secondResponse = await request.get('/api/v1/system/ssh-resources');
    expect(secondResponse.ok()).toBeTruthy();
    const secondResources = (await secondResponse.json()) as Array<{ host: string; port: number; checkedAt: number }>;
    const secondResource = secondResources.find((item) => item.host === E2E_SSH.host && item.port === E2E_SSH.port);
    expect(secondResource).toBeDefined();
    expect(secondResource!.checkedAt).toBeGreaterThan(firstResource!.checkedAt);
  } finally {
    const restoreSettings = await request.put('/api/v1/settings', {
      data: { remoteHostRefreshIntervalSeconds: originalSettings.remoteHostRefreshIntervalSeconds ?? 30 },
    });
    expect(restoreSettings.ok()).toBeTruthy();
    if (connectionId) {
      expect((await request.delete(`/api/v1/connections/${connectionId}`)).ok()).toBeTruthy();
    }
  }
});
