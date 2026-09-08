import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { request as playwrightRequest } from '@playwright/test';
import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { E2E_ADMIN, loginAsInitialAdmin } from '../../support/auth';
const {
  openRemoteDesktopWebSocket,
  waitForRemoteDesktopTicketRejection,
  waitForRemoteDesktopUpgradeRejection,
} = require('../../support/remote-desktop-websocket.cjs');

const databasePath = path.resolve(__dirname, '../../.tmp/backend-data/nexus-terminal.db');
const backendBaseUrl = 'http://127.0.0.1:3001';

const sessionCookie = async (request: APIRequestContext): Promise<string> => {
  const storage = await request.storageState();
  return storage.cookies.map(({ name, value }) => `${name}=${value}`).join('; ');
};

const createRdpConnection = async (request: APIRequestContext, name: string): Promise<number> => {
  const created = await request.post('/api/v1/connections', {
    data: {
      type: 'RDP',
      name,
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
  return ((await created.json()) as { connection: { id: number } }).connection.id;
};

const createSessionTicket = async (request: APIRequestContext, connectionId: number): Promise<string> => {
  const session = await request.post(`/api/v1/connections/${connectionId}/rdp-session?width=1600&height=1000&dpi=144`);
  expect(session.status(), await session.text()).toBe(200);
  const payload = (await session.json()) as { ticket: string };
  expect(payload).toMatchObject({ ticket: expect.any(String) });
  expect(Object.keys(payload)).toEqual(['ticket']);
  expect(payload.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return payload.ticket;
};

const insertUserWithAdminPassword = (username: string): void => {
  const script = String.raw`
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.argv[1]);
    try {
      const source = db.prepare('SELECT hashed_password FROM users WHERE username = ?').get(process.argv[2]);
      if (!source?.hashed_password) throw new Error('Seed admin password hash is missing.');
      db.prepare('INSERT INTO users (username, hashed_password) VALUES (?, ?)').run(process.argv[3], source.hashed_password);
    } finally {
      db.close();
    }
  `;
  execFileSync(process.execPath, ['-e', script, databasePath, E2E_ADMIN.username, username], { stdio: 'pipe' });
};

test('RDP RemoteApp options persist and create a remote desktop session', async ({ request }) => {
  await loginAsInitialAdmin(request);
  const connectionId = await createRdpConnection(request, 'E2E HTTP RDP RemoteApp');

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

  const ticket = await createSessionTicket(request, connectionId);
  const cookie = await sessionCookie(request);
  expect(cookie).toBeTruthy();

  const tunnel = (await openRemoteDesktopWebSocket(ticket, cookie)) as {
    firstMessage: string;
    close(): void;
  };
  expect(tunnel.firstMessage).toMatch(/(?:size|sync|name)/);
  tunnel.close();

  const reused = (await waitForRemoteDesktopTicketRejection(ticket, cookie)) as { code: number; reason: string };
  expect(reused.code).toBe(1008);
  expect(reused.reason).toContain('ticket');
});

test('remote desktop ticket is bound to its authenticated user without consuming the owner ticket', async ({
  request,
}) => {
  await loginAsInitialAdmin(request);
  const connectionId = await createRdpConnection(request, 'E2E RDP ticket user binding');
  const ticket = await createSessionTicket(request, connectionId);
  const ownerCookie = await sessionCookie(request);

  const otherUsername = 'e2e-ticket-other-user';
  insertUserWithAdminPassword(otherUsername);
  const otherRequest = await playwrightRequest.newContext({ baseURL: backendBaseUrl });
  try {
    const login = await otherRequest.post('/api/v1/auth/login', {
      data: { username: otherUsername, password: E2E_ADMIN.password, rememberMe: false },
    });
    expect(login.ok(), await login.text()).toBeTruthy();
    const otherCookie = await sessionCookie(otherRequest);
    expect(otherCookie).toBeTruthy();

    const rejected = (await waitForRemoteDesktopTicketRejection(ticket, otherCookie)) as {
      code: number;
      reason: string;
    };
    expect(rejected.code).toBe(1008);
    expect(rejected.reason).toContain('ticket');

    const ownerTunnel = (await openRemoteDesktopWebSocket(ticket, ownerCookie)) as {
      firstMessage: string;
      close(): void;
    };
    expect(ownerTunnel.firstMessage).toMatch(/(?:size|sync|name)/);
    ownerTunnel.close();
  } finally {
    await otherRequest.dispose();
  }
});

test('expired, unknown, and oversized remote desktop tickets are rejected', async ({ request }) => {
  await loginAsInitialAdmin(request);
  const cookie = await sessionCookie(request);

  const unknown = (await waitForRemoteDesktopTicketRejection('not-a-real-ticket', cookie)) as {
    code: number;
    reason: string;
  };
  expect(unknown.code).toBe(1008);
  expect(unknown.reason).toContain('ticket');

  const oversized = (await waitForRemoteDesktopUpgradeRejection('x'.repeat(257), cookie)) as { statusCode: number };
  expect(oversized.statusCode).toBe(400);

  const connectionId = await createRdpConnection(request, 'E2E RDP expired ticket');
  const expiringTicket = await createSessionTicket(request, connectionId);
  await new Promise((resolve) => setTimeout(resolve, 31_000));
  const expired = (await waitForRemoteDesktopTicketRejection(expiringTicket, cookie)) as {
    code: number;
    reason: string;
  };
  expect(expired.code).toBe(1008);
  expect(expired.reason).toContain('ticket');
});
