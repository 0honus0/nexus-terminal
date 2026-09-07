import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { ensureTestSshConnection, resetTestSshFilesystem } from '../../support/ssh';
import { closeWebSocket, openWorkspaceSession, requestWorkspace, waitForFilesystemReady } from '../../support/ws';

const query = (values: Record<string, string | number>): string =>
  new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)])).toString();

test('HTTP download ticket, Range, inline file, and directory ZIP work for an active SSH session', async ({
  request,
}) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const session = await openWorkspaceSession(request, connectionId, `filesystem-${crypto.randomUUID()}`);

  try {
    await waitForFilesystemReady(session.socket);

    const ticketResponse = await request.post('/api/v1/sftp/download-ticket', {
      data: {
        connectionId,
        sessionId: session.workspaceId,
        remotePath: '/seed.txt',
      },
    });
    expect(ticketResponse.status()).toBe(201);
    const ticket = (await ticketResponse.json()) as { url: string; expiresInSeconds: number };
    expect(ticket.expiresInSeconds).toBe(300);

    const ownerHeaders = { 'X-Forwarded-For': '203.0.113.10' };
    const headResponse = await request.head(ticket.url, { headers: ownerHeaders });
    expect(headResponse.status()).toBe(200);
    expect(headResponse.headers()['accept-ranges']).toBe('bytes');
    expect(Number(headResponse.headers()['content-length'])).toBe(Buffer.byteLength('nexus-e2e-seed\n'));

    const probeResponse = await request.get(ticket.url, { headers: ownerHeaders });
    expect(probeResponse.status()).toBe(200);
    expect(probeResponse.headers()['content-disposition']).toContain('seed.txt');
    expect((await probeResponse.body()).toString('utf8')).toBe('nexus-e2e-seed\n');

    const retryAfterProbe = await request.get(ticket.url, { headers: ownerHeaders });
    expect(retryAfterProbe.status()).toBe(200);
    expect((await retryAfterProbe.body()).toString('utf8')).toBe('nexus-e2e-seed\n');

    const rangeResponse = await request.get(ticket.url, {
      headers: { ...ownerHeaders, Range: 'bytes=0-4' },
    });
    expect(rangeResponse.status()).toBe(206);
    expect(rangeResponse.headers()['content-range']).toBe('bytes 0-4/15');
    expect((await rangeResponse.body()).toString('utf8')).toBe('nexus');

    const competingClient = await request.get(ticket.url, {
      headers: { 'X-Forwarded-For': '198.51.100.20', Range: 'bytes=5-9' },
    });
    expect(competingClient.status()).toBe(423);

    const remainder = await request.get(ticket.url, {
      headers: { ...ownerHeaders, Range: 'bytes=5-' },
    });
    expect(remainder.status()).toBe(206);
    expect((await remainder.body()).toString('utf8')).toBe('-e2e-seed\n');

    const reusableAfterRanges = await request.head(ticket.url, { headers: ownerHeaders });
    expect(reusableAfterRanges.status()).toBe(200);

    const inlineResponse = await request.get(
      `/api/v1/sftp/download?${query({
        connectionId,
        sessionId: session.workspaceId,
        remotePath: '/seed.txt',
        disposition: 'inline',
      })}`,
    );
    expect(inlineResponse.status()).toBe(200);
    expect((await inlineResponse.body()).toString('utf8')).toBe('nexus-e2e-seed\n');

    const directoryResponse = await request.get(
      `/api/v1/sftp/download-directory?${query({
        connectionId,
        sessionId: session.workspaceId,
        remotePath: '/folder-seed',
      })}`,
    );
    expect(directoryResponse.status()).toBe(200);
    expect(directoryResponse.headers()['content-type']).toContain('application/zip');
    const zip = await directoryResponse.body();
    expect(zip.subarray(0, 2).toString('ascii')).toBe('PK');

    const capacityUrls: string[] = [];
    for (let index = 0; index < 65; index += 1) {
      const issued = await request.post('/api/v1/sftp/download-ticket', {
        data: {
          connectionId,
          sessionId: session.workspaceId,
          remotePath: '/seed.txt',
        },
      });
      expect(issued.status()).toBe(201);
      capacityUrls.push(((await issued.json()) as { url: string }).url);
    }
    const evicted = await request.head(capacityUrls[0], {
      headers: { 'X-Forwarded-For': '203.0.113.30' },
    });
    expect(evicted.status()).toBe(410);
    const newest = await request.get(capacityUrls.at(-1)!, {
      headers: { 'X-Forwarded-For': '203.0.113.30' },
    });
    expect(newest.status()).toBe(200);
    expect((await newest.body()).toString('utf8')).toBe('nexus-e2e-seed\n');

    const changedFileTicketResponse = await request.post('/api/v1/sftp/download-ticket', {
      data: {
        connectionId,
        sessionId: session.workspaceId,
        remotePath: '/seed.txt',
      },
    });
    expect(changedFileTicketResponse.status()).toBe(201);
    const changedFileTicket = (await changedFileTicketResponse.json()) as { url: string };
    await requestWorkspace(session.socket, 'filesystem.writeText', {
      path: '/seed.txt',
      content: 'ticket-invalidated-after-remote-change\n',
      encoding: 'utf-8',
    });
    const invalidated = await request.get(changedFileTicket.url, {
      headers: { 'X-Forwarded-For': '203.0.113.40' },
    });
    expect(invalidated.status()).toBe(410);
  } finally {
    await closeWebSocket(session.socket);
  }
});
