import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { ensureTestSshConnection } from '../../support/ssh';
import { closeWebSocket, openWorkspaceSession, requestWorkspaceBinary, waitForFilesystemReady } from '../../support/ws';

test('binary reads require a valid byte budget and recover after an oversized read rejection', async ({ request }) => {
  await loginAsInitialAdmin(request);
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId);
  try {
    await waitForFilesystemReady(workspace.socket);
    const read = (budget: Record<string, unknown>) =>
      requestWorkspaceBinary(workspace.socket, 'filesystem.readBinary', { path: '/seed.txt', ...budget });
    for (const budget of [
      {},
      { maxBytes: 0 },
      { maxBytes: -1 },
      { maxBytes: 1.5 },
      { maxBytes: 64 * 1024 * 1024 + 1 },
    ]) {
      await expect(read(budget)).rejects.toThrow(/filesystem.readBinary failed:/);
    }
    const baseline = await read({ maxBytes: 1024 });
    expect(baseline.bytes.length).toBeGreaterThan(1);
    await expect(read({ maxBytes: baseline.bytes.length - 1 })).rejects.toThrow(/filesystem.readBinary failed:/);
    const exact = await read({ maxBytes: baseline.bytes.length });
    expect(exact.bytes).toEqual(baseline.bytes);
  } finally {
    await closeWebSocket(workspace.socket);
  }
});
