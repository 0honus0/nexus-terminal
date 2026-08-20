import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';

const TEST_GATEWAY_URL = 'http://127.0.0.1:29090';

test('RDP RemoteApp options persist and are forwarded with display-update resize settings', async ({ request }) => {
  await loginAsInitialAdmin(request);
  expect((await request.post(`${TEST_GATEWAY_URL}/control/reset`)).ok()).toBeTruthy();

  const created = await request.post('/api/v1/connections', {
    data: {
      type: 'RDP',
      name: 'E2E HTTP RDP RemoteApp',
      host: '192.0.2.88',
      port: 3389,
      username: 'rdp-http-user',
      password: 'rdp-http-password',
      rdp_options: {
        remote_app: '||notepad',
        remote_app_dir: 'C:\\RemoteApps',
        remote_app_args: '/A sample.txt',
      },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const connectionId = (await created.json() as { connection: { id: number } }).connection.id;

  const persisted = await request.get(`/api/v1/connections/${connectionId}`);
  expect(persisted.ok()).toBeTruthy();
  await expect(persisted.json()).resolves.toMatchObject({
    id: connectionId,
    type: 'RDP',
    rdp_options: {
      remote_app: 'notepad',
      remote_app_dir: 'C:\\RemoteApps',
      remote_app_args: '/A sample.txt',
    },
  });

  const session = await request.post(`/api/v1/connections/${connectionId}/rdp-session?width=1600&height=1000&dpi=144`);
  expect(session.status(), await session.text()).toBe(200);
  await expect(session.json()).resolves.toMatchObject({ token: 'e2e-remote-desktop-token' });

  await expect.poll(async () => {
    const response = await request.get(`${TEST_GATEWAY_URL}/control/latest`);
    if (!response.ok()) return null;
    return (await response.json() as { latestRequest: unknown }).latestRequest;
  }).toMatchObject({
    protocol: 'rdp',
    connectionConfig: {
      hostname: '192.0.2.88',
      port: '3389',
      width: '1600',
      height: '1000',
      dpi: '144',
      resizeMethod: 'display-update',
      remoteApp: '||notepad',
      remoteAppDir: 'C:\\RemoteApps',
      remoteAppArgs: '/A sample.txt',
    },
  });
});
