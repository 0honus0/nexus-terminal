import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, ensureTestSshConnection } from '../../support/ssh';
import { E2E_URLS } from '../../support/test-env';
import { closeWebSocket, openWorkspaceSession, waitForFilesystemReady } from '../../support/ws';

test('HTTP downloads reject excess admission and reclaim delayed OPEN handles after consumer abort', async ({
  request,
}) => {
  await loginAsInitialAdmin(request);
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId);
  const url = `/api/v1/sftp/download?connectionId=${connectionId}&sessionId=${workspace.workspaceId}&remotePath=%2Fseed.txt`;
  const handles = async () => {
    const response = await fetch(`${E2E_SSH.controlUrl}/sftp/read-handles`);
    expect(response.ok).toBeTruthy();
    return response.json() as Promise<{ opened: number; closed: number }>;
  };
  const controllers = Array.from({ length: 8 }, () => new AbortController());
  let downloads: Promise<string>[] = [];
  try {
    await waitForFilesystemReady(workspace.socket);
    const baselineResponse = await request.get(url);
    expect(baselineResponse.status()).toBe(200);
    const bytes = await baselineResponse.body();
    const baseline = await handles();
    const ticketResponse = await request.post('/api/v1/sftp/download-ticket', {
      data: { connectionId, sessionId: workspace.workspaceId, remotePath: '/seed.txt' },
    });
    expect(ticketResponse.ok()).toBeTruthy();
    const ticket = (await ticketResponse.json()) as { url: string };
    const cookie = (await request.storageState()).cookies.map((entry) => `${entry.name}=${entry.value}`).join('; ');
    expect((await fetch(`${E2E_SSH.controlUrl}/sftp/open-delay?ms=3000`, { method: 'POST' })).ok).toBeTruthy();
    downloads = controllers.map((controller) =>
      fetch(new URL(url, E2E_URLS.frontendOrigin), {
        headers: { Cookie: cookie },
        signal: controller.signal,
      }).then(
        async (response) => {
          await response.arrayBuffer();
          return `completed:${response.status}`;
        },
        (error: Error) => error.name,
      ),
    );
    await expect
      .poll(async () => {
        const response = await fetch(`${E2E_SSH.controlUrl}/sftp/open-delay`);
        return (await response.json()).sftpDelayedOpenCount;
      })
      .toBe(8);
    const excess = await request.get(url);
    expect(excess.status()).toBe(429);
    expect((await request.get(ticket.url)).status()).toBe(429);
    // HEAD consumes no remote read slot and must remain available at capacity.
    expect((await request.head(url)).status()).toBe(200);
    for (const controller of controllers) controller.abort();
    expect(await Promise.all(downloads)).toEqual(Array(8).fill('AbortError'));
    await expect.poll(handles).toEqual({ opened: baseline.opened + 8, closed: baseline.closed + 8 });
    expect((await fetch(`${E2E_SSH.controlUrl}/sftp/open-delay?ms=0`, { method: 'POST' })).ok).toBeTruthy();
    const recovered = await Promise.all(controllers.map(() => request.get(url)));
    for (const response of recovered) {
      expect(response.status()).toBe(200);
      expect(await response.body()).toEqual(bytes);
    }
    const ticketRecovery = await request.get(ticket.url);
    expect(ticketRecovery.status()).toBe(200);
    expect(await ticketRecovery.body()).toEqual(bytes);
    // Receiving Content-Length bytes can precede remote CLOSE/pipeline cleanup.
    // Observe remote handle settlement; HTTP handler admission can settle later.
    await expect.poll(handles).toEqual({ opened: baseline.opened + 17, closed: baseline.closed + 17 });
    // Detect accumulated failure-path leaks without assuming body receipt or
    // remote CLOSE is a full-capacity HTTP cleanup barrier.
    for (let attempt = 0; attempt < 16; attempt++) {
      const missing = await request.get(url.replace('%2Fseed.txt', '%2Fmissing-download-e2e.txt'));
      expect(missing.status()).toBe(404);
      await missing.dispose();
    }
    const afterFailure = await request.get(url);
    expect(afterFailure.status()).toBe(200);
    expect(await afterFailure.body()).toEqual(bytes);
  } finally {
    for (const controller of controllers) controller.abort();
    await Promise.allSettled(downloads);
    await fetch(`${E2E_SSH.controlUrl}/sftp/open-delay?ms=0`, { method: 'POST' });
    await closeWebSocket(workspace.socket);
  }
});
