import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, ensureTestSshConnection } from '../../support/ssh';
import {
  closeWebSocket,
  openWorkspaceSession,
  requestWorkspace,
  requestWorkspaceBinary,
  waitForFilesystemReady,
} from '../../support/ws';

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
      { maxBytes: '1024' },
      { maxBytes: true },
      { maxBytes: [1024] },
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

test('four delayed binary reads reject excess admission and cancellation frees every slot', async ({ request }) => {
  await loginAsInitialAdmin(request);
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId);
  const delay = async (ms: number) => {
    const response = await fetch(`${E2E_SSH.controlUrl}/sftp/read-delay?ms=${ms}`, { method: 'POST' });
    expect(response.ok).toBeTruthy();
  };
  const pending: Array<Promise<unknown>> = [];
  try {
    await waitForFilesystemReady(workspace.socket);
    await delay(1000);
    const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
    for (const id of ids) {
      pending.push(
        requestWorkspaceBinary(
          workspace.socket,
          'filesystem.readBinary',
          { path: '/seed.txt', maxBytes: 1024 },
          id,
        ).then(
          () => ({ completed: true }),
          (error: Error) => ({ error: error.message }),
        ),
      );
    }
    await requestWorkspace(workspace.socket, 'workspace.ping');
    await expect(
      requestWorkspaceBinary(workspace.socket, 'filesystem.readBinary', { path: '/seed.txt', maxBytes: 1024 }),
    ).rejects.toThrow('BINARY_READ_CAPACITY_EXCEEDED');
    for (const id of ids)
      expect(await requestWorkspace(workspace.socket, 'filesystem.cancelRead', { requestId: id })).toBe(true);
    for (const result of await Promise.all(pending))
      expect(result).toMatchObject({ error: expect.stringContaining('BINARY_READ_ABORTED') });
    await delay(0);
    const recovered = await Promise.all(
      Array.from({ length: 4 }, () =>
        requestWorkspaceBinary(workspace.socket, 'filesystem.readBinary', { path: '/seed.txt', maxBytes: 1024 }),
      ),
    );
    for (const result of recovered) expect(result.bytes).toEqual(recovered[0].bytes);
    expect(recovered[0].bytes.length).toBeGreaterThan(0);
  } finally {
    await delay(0);
    await closeWebSocket(workspace.socket);
    await Promise.allSettled(pending);
  }
});
