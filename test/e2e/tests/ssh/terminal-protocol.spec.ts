import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { ensureTestSshConnection, resetTestSshFilesystem } from '../../support/ssh';
import { closeWebSocket, openAuthenticatedWebSocket, sendJson, waitForJson } from '../../support/ws';

test('the first directory change waits for a real shell prompt instead of reporting foreground activity', async ({
  request,
}) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const targetPath = '/folder-seed';
  const socket = await openAuthenticatedWebSocket(request);
  const requestMessages: Array<{ type?: string; requestId?: string; payload?: any }> = [];

  try {
    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) return;
      try {
        const parsed = JSON.parse(data.toString('utf8'));
        if (parsed.requestId) requestMessages.push(parsed);
      } catch {
        /* terminal output is ignored */
      }
    });

    const connectedPromise = waitForJson(socket, (message) => message.type === 'ssh:connected');
    sendJson(socket, {
      type: 'ssh:connect',
      payload: { connectionId: String(connectionId), clientSessionId: `cwd-${crypto.randomUUID()}` },
    });
    await connectedPromise;

    // Historical race: issue the first cwd change immediately after ssh:connected.
    const requestId = `cwd-${crypto.randomUUID()}`;
    const finalPromise = waitForJson(
      socket,
      (message) =>
        message.requestId === requestId &&
        (message.type === 'ssh:change_directory:result' || message.type === 'ssh:change_directory:error'),
      20_000,
    );
    sendJson(socket, { type: 'ssh:change_directory', payload: { path: targetPath }, requestId });
    const final = await finalPromise;

    expect(final.type).toBe('ssh:change_directory:result');
    expect(final.payload).toMatchObject({ path: targetPath });
    expect(
      requestMessages.some(
        (message) => message.requestId === requestId && message.type === 'ssh:change_directory:error',
      ),
    ).toBeFalsy();
  } finally {
    await closeWebSocket(socket);
  }
});

test('directory changes reject terminal control characters before writing to the PTY', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const socket = await openAuthenticatedWebSocket(request);

  try {
    const connectedPromise = waitForJson(socket, (message) => message.type === 'ssh:connected');
    sendJson(socket, {
      type: 'ssh:connect',
      payload: { connectionId: String(connectionId), clientSessionId: `cwd-control-${crypto.randomUUID()}` },
    });
    await connectedPromise;

    const requestId = `cwd-control-${crypto.randomUUID()}`;
    const errorPromise = waitForJson(
      socket,
      (message) => message.requestId === requestId && message.type === 'ssh:change_directory:error',
      10_000,
    );
    sendJson(socket, {
      type: 'ssh:change_directory',
      payload: { path: '/folder-seed\nsecond-command' },
      requestId,
    });
    const response = await errorPromise;

    expect(response.payload?.error).toContain('控制字符');
  } finally {
    await closeWebSocket(socket);
  }
});
