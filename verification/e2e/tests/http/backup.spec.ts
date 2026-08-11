import { expect, test } from '@playwright/test';
import { E2E_ADMIN, loginAsInitialAdmin } from '../../support/auth';

const BACKUP_CONNECTION_NAME = 'E2E Backup SSH';

test('full backup restores settings and connection data', async ({ request }) => {
  await loginAsInitialAdmin(request);

  await test.step('prepare data that must survive backup and restore', async () => {
    const currentConnections = await request.get('/api/v1/connections');
    expect(currentConnections.ok()).toBeTruthy();
    for (const connection of await currentConnections.json() as Array<{ id: number; name?: string }>) {
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
        auth_method: 'password',
        password: 'e2e-password',
      },
    });
    expect(create.status()).toBe(201);

    const setting = await request.put('/api/v1/settings', {
      data: { showPopupFileManager: 'true' },
    });
    expect(setting.ok()).toBeTruthy();
  });

  let backup: Buffer;
  await test.step('export an encrypted full backup', async () => {
    const response = await request.post('/api/v1/settings/backup/export', {
      data: { password: E2E_ADMIN.password },
    });
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-disposition']).toContain('.nexus-backup');
    backup = Buffer.from(await response.body());
    expect(backup.subarray(0, 25).toString('utf8')).toContain('NEXUS_TERMINAL_BACKUP_V1');
  });

  await test.step('destroy the backed up data', async () => {
    const connections = await request.get('/api/v1/connections');
    const target = (await connections.json() as Array<{ id: number; name?: string }>).find(
      (connection) => connection.name === BACKUP_CONNECTION_NAME,
    );
    expect(target).toBeTruthy();
    expect((await request.delete(`/api/v1/connections/${target!.id}`)).ok()).toBeTruthy();
    expect((await request.put('/api/v1/settings', { data: { showPopupFileManager: 'false' } })).ok()).toBeTruthy();
  });

  await test.step('import the backup and restore the data', async () => {
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

  await test.step('verify settings and encrypted connection credentials survived restore', async () => {
    const settings = await request.get('/api/v1/settings');
    expect(settings.ok()).toBeTruthy();
    await expect(settings.json()).resolves.toMatchObject({ showPopupFileManager: 'true' });

    const connections = await request.get('/api/v1/connections');
    expect(connections.ok()).toBeTruthy();
    const restored = (await connections.json() as Array<{ id: number; name?: string }>).find(
      (connection) => connection.name === BACKUP_CONNECTION_NAME,
    );
    expect(restored).toBeTruthy();

    const connectionTest = await request.post(`/api/v1/connections/${restored!.id}/test`);
    expect(connectionTest.ok()).toBeTruthy();
    await expect(connectionTest.json()).resolves.toMatchObject({ success: true });
  });
});
