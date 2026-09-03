import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { ensureTestSshConnection, resetTestSshFilesystem } from '../../support/ssh';
import { closeWebSocket, openSshSession, waitForSftpReady } from '../../support/ws';

const query = (values: Record<string, string | number>): string =>
  new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)])).toString();

test('HTTP download ticket, Range, inline file, and directory ZIP work for an active SSH session', async ({
  request,
}) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const session = await openSshSession(request, connectionId, `filesystem-${crypto.randomUUID()}`);

  try {
    await waitForSftpReady(session.socket);

    const ticketResponse = await request.post('/api/v1/sftp/download-ticket', {
      data: {
        connectionId,
        sessionId: session.sessionId,
        remotePath: '/seed.txt',
      },
    });
    expect(ticketResponse.status()).toBe(201);
    const ticket = (await ticketResponse.json()) as { url: string; expiresInSeconds: number };
    expect(ticket.expiresInSeconds).toBe(300);

    const rangeResponse = await request.get(ticket.url, {
      headers: { Range: 'bytes=0-4' },
    });
    expect(rangeResponse.status()).toBe(206);
    expect(rangeResponse.headers()['content-range']).toBe('bytes 0-4/15');
    expect((await rangeResponse.body()).toString('utf8')).toBe('nexus');

    const inlineResponse = await request.get(
      `/api/v1/sftp/download?${query({
        connectionId,
        sessionId: session.sessionId,
        remotePath: '/seed.txt',
        disposition: 'inline',
      })}`,
    );
    expect(inlineResponse.status()).toBe(200);
    expect((await inlineResponse.body()).toString('utf8')).toBe('nexus-e2e-seed\n');

    const directoryResponse = await request.get(
      `/api/v1/sftp/download-directory?${query({
        connectionId,
        sessionId: session.sessionId,
        remotePath: '/folder-seed',
      })}`,
    );
    expect(directoryResponse.status()).toBe(200);
    expect(directoryResponse.headers()['content-type']).toContain('application/zip');
    const zip = await directoryResponse.body();
    expect(zip.subarray(0, 2).toString('ascii')).toBe('PK');
  } finally {
    await closeWebSocket(session.socket);
  }
});
