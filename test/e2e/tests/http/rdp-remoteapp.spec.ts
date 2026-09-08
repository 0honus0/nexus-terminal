import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
const { openRemoteDesktopWebSocket, reuseRemoteDesktopTicket } = require('../../support/remote-desktop-websocket.cjs');

test('RDP RemoteApp options persist and create a remote desktop session', async ({ request }) => {
  await loginAsInitialAdmin(request);
  const created = await request.post('/api/v1/connections', {
    data: {
      type: 'RDP',
      name: 'E2E HTTP RDP RemoteApp',
      host: '192.0.2.88',
      port: 3389,
      username: 'rdp-http-user',
      password: 'rdp-http-password',
      rdpOptions: {
        remoteApp: '||notepad',
        remoteAppDirectory: 'C:\\RemoteApps',
        remoteAppArguments: '/A sample.txt',
      },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const connectionId = ((await created.json()) as { connection: { id: number } }).connection.id;

  const persisted = await request.get(`/api/v1/connections/${connectionId}`);
  expect(persisted.ok()).toBeTruthy();
  await expect(persisted.json()).resolves.toMatchObject({
    id: connectionId,
    type: 'RDP',
    rdpOptions: {
      remoteApp: 'notepad',
      remoteAppDirectory: 'C:\\RemoteApps',
      remoteAppArguments: '/A sample.txt',
    },
  });

  const session = await request.post(`/api/v1/connections/${connectionId}/rdp-session?width=1600&height=1000&dpi=144`);
  expect(session.status(), await session.text()).toBe(200);
  const sessionPayload = (await session.json()) as { ticket: string };
  expect(sessionPayload).toMatchObject({ ticket: expect.any(String) });
  expect(Object.keys(sessionPayload)).toEqual(['ticket']);
  expect(sessionPayload.ticket.length).toBeGreaterThanOrEqual(32);

  const storage = await request.storageState();
  const cookie = storage.cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
  expect(cookie).toBeTruthy();

  const tunnel = (await openRemoteDesktopWebSocket(sessionPayload.ticket, cookie)) as {
    firstMessage: string;
    close(): void;
  };
  expect(tunnel.firstMessage).toMatch(/(?:size|sync|name)/);
  tunnel.close();

  const reused = (await reuseRemoteDesktopTicket(sessionPayload.ticket, cookie)) as { code: number; reason: string };
  expect(reused.code).toBe(1008);
  expect(reused.reason).toContain('ticket');
});
