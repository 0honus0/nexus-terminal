import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH } from '../../support/ssh';

test('quick command tag batches deduplicate IDs and reject raw oversized input without adding associations', async ({
  request,
}) => {
  await loginAsInitialAdmin(request);
  const created = await request.post('/api/v1/quick-commands', {
    data: { name: `E2E bulk ${randomUUID()}`, command: 'echo e2e', tagIds: [] },
  });
  expect(created.status()).toBe(201);
  const { command } = (await created.json()) as { command: { id: number } };
  const tags: number[] = [];
  try {
    for (let index = 0; index < 2; index++) {
      const response = await request.post('/api/v1/quick-command-tags', {
        data: { name: `E2E bulk tag ${randomUUID()}` },
      });
      expect(response.status()).toBe(201);
      tags.push((await response.json()).tag.id);
    }
    const assign = (commandIds: number[], tagId: number) =>
      request.post('/api/v1/quick-commands/bulk-assign-tag', { data: { commandIds, tagId } });
    expect((await assign([command.id, command.id], tags[0])).ok()).toBeTruthy();
    for (const tagId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const rejected = await assign([command.id], tagId);
      expect(rejected.status(), await rejected.text()).toBe(400);
    }
    for (const ids of [Array(1001).fill(command.id), [command.id, 0], [command.id, Number.MAX_SAFE_INTEGER + 1]]) {
      const rejected = await assign(ids, tags[1]);
      expect(rejected.status(), await rejected.text()).toBe(400);
      const response = await request.get('/api/v1/quick-commands');
      expect(response.ok()).toBeTruthy();
      const saved = ((await response.json()) as Array<{ id: number; tagIds: number[] }>).find(
        (item) => item.id === command.id,
      )!;
      expect(saved.tagIds).toEqual([tags[0]]);
    }
    expect((await assign([command.id], tags[1])).ok()).toBeTruthy();
    const response = await request.get('/api/v1/quick-commands');
    expect(response.ok()).toBeTruthy();
    const saved = ((await response.json()) as Array<{ id: number; tagIds: number[] }>).find(
      (item) => item.id === command.id,
    )!;
    expect(saved.tagIds.sort()).toEqual([...tags].sort());
  } finally {
    expect((await request.delete(`/api/v1/quick-commands/${command.id}`)).ok()).toBeTruthy();
    for (const id of tags) expect((await request.delete(`/api/v1/quick-command-tags/${id}`)).ok()).toBeTruthy();
  }
});

test('proxy credential updates reject invalid effective authentication without partial metadata writes', async ({
  request,
}) => {
  await loginAsInitialAdmin(request);
  for (const authMethod of ['password', 'key']) {
    const name = `E2E proxy invariant ${randomUUID()}`;
    const field = authMethod === 'password' ? 'password' : 'privateKey';
    const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
      type: 'pkcs1',
      format: 'pem',
    });
    const created = await request.post('/api/v1/proxies', {
      data: {
        name,
        type: 'SOCKS5',
        host: '127.0.0.1',
        port: 1080,
        username: 'e2e',
        authMethod,
        [field]: authMethod === 'password' ? 'e2e-proxy-secret' : privateKey,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { proxy } = (await created.json()) as { proxy: { id: number } };
    try {
      for (const value of [null, '']) {
        const rejected = await request.put(`/api/v1/proxies/${proxy.id}`, {
          data: { name: `${name} rejected`, [field]: value },
        });
        expect(rejected.status(), await rejected.text()).toBe(400);
        const saved = await request.get(`/api/v1/proxies/${proxy.id}`);
        expect(saved.ok()).toBeTruthy();
        await expect(saved.json()).resolves.toMatchObject({ name, authMethod });
      }
      const preserved = await request.put(`/api/v1/proxies/${proxy.id}`, { data: { name: `${name} preserved` } });
      expect(preserved.ok()).toBeTruthy();
      const cleared = await request.put(`/api/v1/proxies/${proxy.id}`, { data: { authMethod: 'none' } });
      expect(cleared.ok()).toBeTruthy();
      const cannotReuse = await request.put(`/api/v1/proxies/${proxy.id}`, { data: { authMethod } });
      expect(cannotReuse.status()).toBe(400);
      await expect((await request.get(`/api/v1/proxies/${proxy.id}`)).json()).resolves.toMatchObject({
        authMethod: 'none',
      });
    } finally {
      expect((await request.delete(`/api/v1/proxies/${proxy.id}`)).ok()).toBeTruthy();
    }
  }
});

test('SSH key mutations persist actor and field-only audit records without credential content', async ({ request }) => {
  await loginAsInitialAdmin(request);
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs1', format: 'pem' })
    .toString();
  const passphrase = `e2e-secret-${randomUUID()}`;
  const created = await request.post('/api/v1/ssh-keys', {
    data: { name: `E2E audit ${randomUUID()}`, privateKey, passphrase },
  });
  expect(created.status()).toBe(201);
  const { key } = (await created.json()) as { key: { id: number } };
  try {
    expect(
      (
        await request.put(`/api/v1/ssh-keys/${key.id}`, { data: { name: 'E2E audited rename', passphrase: null } })
      ).ok(),
    ).toBeTruthy();
    expect((await request.delete(`/api/v1/ssh-keys/${key.id}`)).ok()).toBeTruthy();
    const response = await request.get('/api/v1/audit-logs?limit=100&offset=0');
    expect(response.ok()).toBeTruthy();
    const text = await response.text();
    expect(text).not.toContain(passphrase);
    expect(text).not.toContain('PRIVATE KEY');
    expect(text).not.toContain(privateKey.split('\n')[1]);
    const { logs } = JSON.parse(text) as { logs: Array<{ actionType: string; details: Record<string, unknown> }> };
    for (const actionType of ['SSH_KEY_CREATED', 'SSH_KEY_UPDATED', 'SSH_KEY_DELETED']) {
      const log = logs.find((item) => item.actionType === actionType && item.details.keyId === key.id);
      expect(log).toBeDefined();
      expect(log!.details).toMatchObject({ userId: expect.any(Number), ip: expect.any(String) });
      if (actionType === 'SSH_KEY_UPDATED') expect(log!.details.updatedFields).toEqual(['name', 'passphrase']);
    }
  } finally {
    const removed = await request.delete(`/api/v1/ssh-keys/${key.id}`);
    expect([200, 404]).toContain(removed.status());
  }
});

test('connection tag replacement deduplicates and rejects invalid batches atomically', async ({ request }) => {
  await loginAsInitialAdmin(request);
  const tagResponse = await request.post('/api/v1/tags', { data: { name: `E2E bounded tag ${randomUUID()}` } });
  expect(tagResponse.status()).toBe(201);
  const { tag } = (await tagResponse.json()) as { tag: { id: number } };
  const created = await request.post('/api/v1/connections', {
    data: {
      name: `E2E tag connection ${randomUUID()}`,
      type: 'SSH',
      host: E2E_SSH.host,
      port: E2E_SSH.port,
      username: E2E_SSH.username,
      authMethod: 'password',
      password: E2E_SSH.password,
    },
  });
  expect(created.status()).toBe(201);
  const { connection } = (await created.json()) as { connection: { id: number } };
  const replace = (connectionIds: number[]) =>
    request.put(`/api/v1/tags/${tag.id}/connections`, { data: { connectionIds } });
  const readTags = async () => {
    const response = await request.get(`/api/v1/connections/${connection.id}`);
    expect(response.ok()).toBeTruthy();
    return (await response.json()).tagIds as number[];
  };
  try {
    expect((await replace([connection.id, connection.id])).ok()).toBeTruthy();
    expect(await readTags()).toEqual([tag.id]);
    for (const ids of [[0], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1], Array(1001).fill(connection.id)]) {
      expect((await replace(ids)).status()).toBe(400);
      expect(await readTags()).toEqual([tag.id]);
    }
    expect((await replace([connection.id, Number.MAX_SAFE_INTEGER])).status()).toBe(404);
    expect(await readTags()).toEqual([tag.id]);
    expect(
      (await request.put('/api/v1/tags/9007199254740991/connections', { data: { connectionIds: [] } })).status(),
    ).toBe(404);
    expect((await replace([])).ok()).toBeTruthy();
    expect(await readTags()).toEqual([]);
  } finally {
    expect((await request.delete(`/api/v1/connections/${connection.id}`)).ok()).toBeTruthy();
    expect((await request.delete(`/api/v1/tags/${tag.id}`)).ok()).toBeTruthy();
  }
});

test('deleting an active terminal theme clears its persisted appearance reference', async ({ request }) => {
  await loginAsInitialAdmin(request);
  const before = await request.get('/api/v1/appearance');
  expect(before.ok()).toBeTruthy();
  const original = (await before.json()) as { activeTerminalThemeId: number | null };
  const created = await request.post('/api/v1/terminal-themes', {
    data: {
      name: `E2E active delete ${randomUUID()}`,
      themeData: { background: '#101010', foreground: '#eeeeee' },
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: number };
  try {
    expect((await request.put('/api/v1/appearance', { data: { activeTerminalThemeId: id } })).ok()).toBeTruthy();
    await expect((await request.get('/api/v1/appearance')).json()).resolves.toMatchObject({
      activeTerminalThemeId: id,
    });
    expect((await request.delete(`/api/v1/terminal-themes/${id}`)).ok()).toBeTruthy();
    expect((await request.get(`/api/v1/terminal-themes/${id}`)).status()).toBe(404);
    await expect((await request.get('/api/v1/appearance')).json()).resolves.toMatchObject({
      activeTerminalThemeId: null,
    });
  } finally {
    const removed = await request.delete(`/api/v1/terminal-themes/${id}`);
    expect([200, 404]).toContain(removed.status());
    expect(
      (
        await request.put('/api/v1/appearance', { data: { activeTerminalThemeId: original.activeTerminalThemeId } })
      ).ok(),
    ).toBeTruthy();
  }
});
