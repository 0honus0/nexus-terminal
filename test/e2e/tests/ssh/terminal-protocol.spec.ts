import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, ensureTestSshConnection, resetTestSshFilesystem } from '../../support/ssh';
import { closeWebSocket, openAuthenticatedWebSocket, sendJson, waitForJson } from '../../support/ws';

test('the first directory change waits for a real shell prompt instead of reporting foreground activity', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const health = await fetch(`${E2E_SSH.controlUrl}/health`).then((response) => response.json() as Promise<{ rootDir: string }>);
  const targetPath = `${health.rootDir}/folder-seed`;
  const socket = await openAuthenticatedWebSocket(request);
  const requestMessages: Array<{ type?: string; requestId?: string; payload?: any }> = [];

  try {
    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) return;
      try {
        const parsed = JSON.parse(data.toString('utf8'));
        if (parsed.requestId) requestMessages.push(parsed);
      } catch { /* terminal output is ignored */ }
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
      (message) => message.requestId === requestId
        && (message.type === 'ssh:change_directory:result' || message.type === 'ssh:change_directory:error'),
      20_000,
    );
    sendJson(socket, { type: 'ssh:change_directory', payload: { path: targetPath }, requestId });
    const final = await finalPromise;

    expect(final.type).toBe('ssh:change_directory:result');
    expect(final.payload).toMatchObject({ path: targetPath });
    expect(requestMessages.some(
      (message) => message.requestId === requestId && message.type === 'ssh:change_directory:error',
    )).toBeFalsy();
  } finally {
    await closeWebSocket(socket);
  }
});
