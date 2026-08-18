import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH } from '../../support/ssh';
import { step } from '../../support/steps';

test('connection update, tags, clone, credentials, and delete form a complete lifecycle', async ({ request }) => {
  await loginAsInitialAdmin(request);

  let connectionId = 0;
  let cloneId = 0;
  let tagId = 0;

  await step('create a tagged SSH connection', async () => {
    const tag = await request.post('/api/v1/tags', { data: { name: 'E2E Connection Tag' } });
    expect(tag.status()).toBe(201);
    tagId = (await tag.json() as { tag: { id: number } }).tag.id;

    const create = await request.post('/api/v1/connections', {
      data: {
        name: 'E2E Lifecycle SSH',
        type: 'SSH',
        host: E2E_SSH.host,
        port: E2E_SSH.port,
        username: E2E_SSH.username,
        auth_method: 'password',
        password: E2E_SSH.password,
        notes: 'created by lifecycle e2e',
      },
    });
    expect(create.status()).toBe(201);
    connectionId = (await create.json() as { connection: { id: number } }).connection.id;

    const assignTag = await request.post('/api/v1/connections/add-tag', {
      data: { connection_ids: [connectionId], tag_id: tagId },
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
    const cloned = (await clone.json() as {
      connection: { id: number; name: string; tag_ids?: number[] };
    }).connection;
    cloneId = cloned.id;
    expect(cloned.name).toBe('E2E Lifecycle SSH Clone');
    expect(cloned.tag_ids).toContain(tagId);

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
