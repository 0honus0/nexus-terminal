import { createCipheriv, randomBytes } from 'node:crypto';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, resetTestSshFilesystem } from '../../support/ssh';
import { step } from '../../support/steps';

const E2E_ENCRYPTION_KEY = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');

const legacyEncrypt = (plaintext: string): string => {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', E2E_ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString('base64');
};

test('connection JSON import preserves legacy snake_case and current camelCase formats', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();

  const suffix = crypto.randomUUID().slice(0, 8);
  const legacyName = `E2E Legacy Import ${suffix}`;
  const currentName = `E2E Current Import ${suffix}`;
  const proxyName = `E2E Legacy Import Proxy ${suffix}`;
  const tagName = `E2E Legacy Import Tag ${suffix}`;
  let tagId = 0;
  const createdConnectionIds: number[] = [];
  let createdProxyId = 0;

  try {
    await step('create the tag referenced by the legacy tag_ids field', async () => {
      const tag = await request.post('/api/v1/tags', { data: { name: tagName } });
      expect(tag.status()).toBe(201);
      tagId = ((await tag.json()) as { tag: { id: number } }).tag.id;
    });

    await step('import legacy snake_case plus current camelCase records from one JSON file', async () => {
      const payload = [
        {
          name: legacyName,
          type: 'SSH',
          host: E2E_SSH.host,
          port: E2E_SSH.port,
          username: E2E_SSH.username,
          auth_method: 'password',
          encrypted_password: legacyEncrypt(E2E_SSH.password),
          encrypted_private_key: null,
          encrypted_passphrase: null,
          tag_ids: [tagId],
          proxy: {
            name: proxyName,
            type: 'HTTP',
            host: E2E_SSH.host,
            port: 22223,
            username: 'legacy-proxy-user',
            auth_method: 'password',
            encrypted_password: legacyEncrypt('legacy-proxy-password'),
            encrypted_private_key: null,
            encrypted_passphrase: null,
          },
        },
        {
          name: currentName,
          type: 'SSH',
          host: E2E_SSH.host,
          port: E2E_SSH.port,
          username: E2E_SSH.username,
          authMethod: 'password',
          password: E2E_SSH.password,
        },
      ];
      const response = await request.post('/api/v1/connections/import', {
        multipart: {
          connectionsFile: {
            name: 'connections-import-compatibility.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify(payload), 'utf8'),
          },
        },
      });
      expect(response.status()).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ successCount: 2, failureCount: 0, errors: [] });
    });

    await step('legacy fields are normalized and both imported connections remain usable', async () => {
      const list = await request.get('/api/v1/connections');
      expect(list.ok()).toBeTruthy();
      const connections = (await list.json()) as Array<{
        id: number;
        name?: string;
        tagIds?: number[];
        proxyId?: number | null;
        route?: 'proxy' | 'jump' | null;
      }>;
      const legacy = connections.find((connection) => connection.name === legacyName);
      const current = connections.find((connection) => connection.name === currentName);
      expect(legacy).toBeTruthy();
      expect(current).toBeTruthy();
      expect(legacy?.tagIds).toContain(tagId);
      expect(legacy?.proxyId).toEqual(expect.any(Number));
      expect(legacy?.route ?? null).toBeNull();
      createdConnectionIds.push(legacy!.id, current!.id);

      for (const connection of [legacy!, current!]) {
        const connectionTest = await request.post(`/api/v1/connections/${connection.id}/test`);
        expect(connectionTest.ok()).toBeTruthy();
        await expect(connectionTest.json()).resolves.toMatchObject({ success: true });
      }

      const proxies = await request.get('/api/v1/proxies');
      expect(proxies.ok()).toBeTruthy();
      const proxy = ((await proxies.json()) as Array<{ id: number; name: string }>).find(
        (item) => item.name === proxyName,
      );
      expect(proxy).toBeTruthy();
      createdProxyId = proxy!.id;
    });
  } finally {
    const list = await request.get('/api/v1/connections').catch(() => null);
    if (list?.ok()) {
      const connections = (await list.json()) as Array<{ id: number; name?: string }>;
      for (const connection of connections.filter((item) => item.name === legacyName || item.name === currentName)) {
        createdConnectionIds.push(connection.id);
      }
    }
    for (const id of [...new Set(createdConnectionIds)]) {
      await request.delete(`/api/v1/connections/${id}`).catch(() => undefined);
    }
    if (!createdProxyId) {
      const proxies = await request.get('/api/v1/proxies').catch(() => null);
      if (proxies?.ok()) {
        const proxy = ((await proxies.json()) as Array<{ id: number; name: string }>).find(
          (item) => item.name === proxyName,
        );
        createdProxyId = proxy?.id ?? 0;
      }
    }
    if (createdProxyId) await request.delete(`/api/v1/proxies/${createdProxyId}`).catch(() => undefined);
    if (tagId) await request.delete(`/api/v1/tags/${tagId}`).catch(() => undefined);
  }
});
