import { expect, test } from '../../support/fixtures';
import { E2E_ADMIN, loginAsInitialAdmin } from '../../support/auth';
import { closeWebSocket, openAuthenticatedWebSocket, openWorkspaceSession, requestWorkspace } from '../../support/ws';
import { ensureTestSshConnection } from '../../support/ssh';

test('password rotation revokes established WebSocket capability and requires new-password authentication', async ({
  request,
}) => {
  await loginAsInitialAdmin(request);
  const connectionId = await ensureTestSshConnection(request);
  const { socket } = await openWorkspaceSession(request, connectionId);
  const oldCookie = (await request.storageState()).cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  const password = 'E2e-Rotated-WebSocket-2026!';
  let rotated = false;
  try {
    await requestWorkspace(socket, 'workspace.ping');
    const closed = new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Password rotation did not revoke the socket')), 10_000);
      socket.once('close', (code: number) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });
    const changed = await request.put('/api/v1/auth/password', {
      data: { currentPassword: E2E_ADMIN.password, newPassword: password },
    });
    expect(changed.ok()).toBeTruthy();
    rotated = true;
    await closed;
    expect(socket.readyState).toBe(3);
    expect((await request.get('/api/v1/auth/status')).status()).toBe(401);
    expect((await request.get('/api/v1/auth/status', { headers: { Cookie: oldCookie } })).status()).toBe(401);
    const login = await request.post('/api/v1/auth/login', {
      data: { username: E2E_ADMIN.username, password, rememberMe: false },
    });
    expect(login.ok()).toBeTruthy();
    const { socket: fresh } = await openWorkspaceSession(request, connectionId);
    try {
      await requestWorkspace(fresh, 'workspace.ping');
    } finally {
      await closeWebSocket(fresh);
    }
  } finally {
    await closeWebSocket(socket);
    if (rotated) {
      expect(
        (
          await request.post('/api/v1/auth/login', {
            data: { username: E2E_ADMIN.username, password, rememberMe: false },
          })
        ).ok(),
      ).toBeTruthy();
      expect(
        (
          await request.put('/api/v1/auth/password', {
            data: { currentPassword: password, newPassword: E2E_ADMIN.password },
          })
        ).ok(),
      ).toBeTruthy();
    }
  }
});

test('logout revokes an established Workspace WebSocket and the previous HTTP session', async ({ request }) => {
  await loginAsInitialAdmin(request);
  const connectionId = await ensureTestSshConnection(request);
  const { socket } = await openWorkspaceSession(request, connectionId);
  const oldCookie = (await request.storageState()).cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  try {
    await requestWorkspace(socket, 'workspace.ping');
    const closed = new Promise<{ code: number }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Logout did not revoke the established socket')), 10_000);
      socket.once('close', (code: number) => {
        clearTimeout(timeout);
        resolve({ code });
      });
    });
    expect((await request.post('/api/v1/auth/logout')).ok()).toBeTruthy();
    await closed;
    expect(socket.readyState).toBe(3);
    expect((await request.get('/api/v1/auth/status')).status()).toBe(401);
    expect((await request.get('/api/v1/auth/status', { headers: { Cookie: oldCookie } })).status()).toBe(401);
    await expect(openAuthenticatedWebSocket(request)).rejects.toThrow();
  } finally {
    await closeWebSocket(socket);
  }
});

test.describe('authenticated WebSocket', () => {
  test('rejects a WebSocket upgrade without a login session', async ({ page }) => {
    await page.goto('/login');

    const outcome = await page.evaluate(async () => {
      return await new Promise<'opened' | 'rejected' | 'timeout'>((resolve) => {
        const socketUrl = new URL('/ws/workspace', window.location.origin);
        socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(socketUrl.toString());
        const timeout = window.setTimeout(() => {
          socket.close();
          resolve('timeout');
        }, 5_000);

        socket.addEventListener(
          'open',
          () => {
            window.clearTimeout(timeout);
            socket.close();
            resolve('opened');
          },
          { once: true },
        );
        socket.addEventListener(
          'error',
          () => {
            window.clearTimeout(timeout);
            resolve('rejected');
          },
          { once: true },
        );
      });
    });

    expect(outcome).toBe('rejected');
  });

  test('accepts the authenticated session and routes WebSocket frames', async ({ page, context }) => {
    await loginAsInitialAdmin(context.request);
    await page.goto('/');

    const observedFrames: Array<{ direction: 'sent' | 'received'; payload: string | Buffer }> = [];
    page.on('websocket', (socket) => {
      socket.on('framesent', (event) => observedFrames.push({ direction: 'sent', payload: event.payload }));
      socket.on('framereceived', (event) => observedFrames.push({ direction: 'received', payload: event.payload }));
    });

    const response = await page.evaluate(async () => {
      return await new Promise<{
        type?: string;
        requestId?: string;
        payload?: { ok?: boolean; error?: string };
      }>((resolve, reject) => {
        const socketUrl = new URL('/ws/workspace', window.location.origin);
        socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(socketUrl.toString());
        const timeout = window.setTimeout(() => {
          socket.close();
          reject(new Error('Timed out waiting for WebSocket response'));
        }, 5_000);

        socket.addEventListener(
          'open',
          () => socket.send(JSON.stringify({ type: 'e2e.unsupported', requestId: 'e2e-route-check', payload: {} })),
          { once: true },
        );
        socket.addEventListener(
          'message',
          (event) => {
            window.clearTimeout(timeout);
            socket.close();
            resolve(
              JSON.parse(String(event.data)) as {
                type?: string;
                requestId?: string;
                payload?: { ok?: boolean; error?: string };
              },
            );
          },
          { once: true },
        );
        socket.addEventListener(
          'error',
          () => {
            window.clearTimeout(timeout);
            reject(new Error('Authenticated WebSocket failed to open'));
          },
          { once: true },
        );
      });
    });

    expect(response).toMatchObject({
      type: 'response',
      requestId: 'e2e-route-check',
      payload: { ok: false },
    });
    expect(response.payload?.error).toContain('Unsupported Workspace operation');
    expect(
      observedFrames.some((frame) => frame.direction === 'sent' && String(frame.payload).includes('e2e.unsupported')),
    ).toBeTruthy();
    expect(observedFrames.some((frame) => frame.direction === 'received')).toBeTruthy();
  });
});
