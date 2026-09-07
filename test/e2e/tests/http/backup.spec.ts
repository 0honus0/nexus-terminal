import { expect, test } from '../../support/fixtures';
import { E2E_ADMIN, loginAsInitialAdmin } from '../../support/auth';
import { step, slowStep } from '../../support/steps';

const BACKUP_CONNECTION_NAME = 'E2E Backup SSH';
const BACKUP_MAGIC = 'NEXUS_TERMINAL_BACKUP_V1\n';

test('full backup restores settings and connection data', async ({ request }) => {
  await loginAsInitialAdmin(request);

  await step('prepare data that must survive backup and restore', async () => {
    const currentConnections = await request.get('/api/v1/connections');
    expect(currentConnections.ok()).toBeTruthy();
    for (const connection of (await currentConnections.json()) as Array<{ id: number; name?: string }>) {
      if (connection.name === BACKUP_CONNECTION_NAME) {
        expect((await request.delete(`/api/v1/connections/${connection.id}`)).ok()).toBeTruthy();
      }
    }

    const create = await request.post('/api/v1/connections', {
      data: {
        name: BACKUP_CONNECTION_NAME,
        type: 'SSH',
        host: '127.0.0.1',
        port: 22222,
        username: 'e2e',
        authMethod: 'password',
        password: 'e2e-password',
      },
    });
    expect(create.status()).toBe(201);

    const setting = await request.put('/api/v1/settings', {
      data: { showPopupFileManager: true },
    });
    expect(setting.ok()).toBeTruthy();
  });

  let backup: Buffer;
  await slowStep('export an encrypted full backup', async () => {
    const response = await request.post('/api/v1/settings/backup/export', {
      data: { password: E2E_ADMIN.password },
    });
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-disposition']).toContain('.nexus-backup');
    backup = Buffer.from(await response.body());
    expect(backup.length).toBeGreaterThan(100);
    expect(backup.subarray(0, BACKUP_MAGIC.length).toString('utf8')).toBe(BACKUP_MAGIC);
    const envelope = JSON.parse(backup.subarray(BACKUP_MAGIC.length).toString('utf8')) as {
      format?: string;
      version?: number;
      passwordKdf?: { algorithm?: string; iterations?: number };
      payload?: { iv?: string; ciphertext?: string; tag?: string };
    };
    expect(envelope).toMatchObject({
      format: 'nexus-terminal-backup',
      version: 1,
      passwordKdf: { algorithm: 'pbkdf2-sha256', iterations: 210_000 },
      payload: { iv: expect.any(String), ciphertext: expect.any(String), tag: expect.any(String) },
    });
    expect(envelope).not.toHaveProperty('tables');
    expect(backup.toString('utf8')).not.toContain('e2e-password');
  });

  await step('a wrong password is rejected for a password-protected backup', async () => {
    const envelope = JSON.parse(backup!.subarray(BACKUP_MAGIC.length).toString('utf8')) as {
      instanceWrappedKey: { ciphertext: string };
    };
    const wrappedCiphertext = Buffer.from(envelope.instanceWrappedKey.ciphertext, 'base64');
    wrappedCiphertext[0] ^= 1;
    envelope.instanceWrappedKey.ciphertext = wrappedCiphertext.toString('base64');
    const invalidBackup = Buffer.from(`${BACKUP_MAGIC}${JSON.stringify(envelope)}`, 'utf8');
    const response = await request.post('/api/v1/settings/backup/import', {
      multipart: {
        password: 'definitely-not-the-password',
        backupFile: {
          name: 'invalid-password.nexus-backup',
          mimeType: 'application/octet-stream',
          buffer: invalidBackup,
        },
      },
    });
    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_BACKUP_PASSWORD' });
  });

  await step('destroy the backed up data', async () => {
    const connections = await request.get('/api/v1/connections');
    const target = ((await connections.json()) as Array<{ id: number; name?: string }>).find(
      (connection) => connection.name === BACKUP_CONNECTION_NAME,
    );
    expect(target).toBeTruthy();
    expect((await request.delete(`/api/v1/connections/${target!.id}`)).ok()).toBeTruthy();
    expect((await request.put('/api/v1/settings', { data: { showPopupFileManager: false } })).ok()).toBeTruthy();
  });

  await slowStep('import the backup and restore the data', async () => {
    const response = await request.post('/api/v1/settings/backup/import', {
      multipart: {
        password: E2E_ADMIN.password,
        backupFile: {
          name: 'e2e.nexus-backup',
          mimeType: 'application/octet-stream',
          buffer: backup!,
        },
      },
    });
    expect(response.ok()).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({ message: '备份导入成功。' });
  });

  await slowStep('verify settings and encrypted connection credentials survived restore', async () => {
    const settings = await request.get('/api/v1/settings');
    expect(settings.ok()).toBeTruthy();
    await expect(settings.json()).resolves.toMatchObject({ showPopupFileManager: true });

    const connections = await request.get('/api/v1/connections');
    expect(connections.ok()).toBeTruthy();
    const restored = ((await connections.json()) as Array<{ id: number; name?: string }>).find(
      (connection) => connection.name === BACKUP_CONNECTION_NAME,
    );
    expect(restored).toBeTruthy();

    const connectionTest = await request.post(`/api/v1/connections/${restored!.id}/test`);
    expect(connectionTest.ok()).toBeTruthy();
    await expect(connectionTest.json()).resolves.toMatchObject({ success: true });
  });
});
