import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, ensureTestSshConnection } from '../../support/ssh';
import {
  closeWebSocket,
  openWorkspaceSession,
  requestWorkspace,
  requestWorkspaceBinary,
  sendJson,
  waitForJson,
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

test('rejecting a duplicate binary read ID preserves cancellation of the original read', async ({ request }) => {
  await loginAsInitialAdmin(request);
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId);
  const id = crypto.randomUUID();
  try {
    await waitForFilesystemReady(workspace.socket);
    expect((await fetch(`${E2E_SSH.controlUrl}/sftp/read-delay?ms=1000`, { method: 'POST' })).ok).toBeTruthy();
    const payload = { path: '/seed.txt', maxBytes: 1024 };
    sendJson(workspace.socket, { type: 'filesystem.readBinary', requestId: id, payload });
    await requestWorkspace(workspace.socket, 'workspace.ping');
    const rejected = waitForJson(
      workspace.socket,
      (message) => message.requestId === id && message.payload?.ok === false,
    );
    sendJson(workspace.socket, { type: 'filesystem.readBinary', requestId: id, payload });
    expect((await rejected).payload.error).toBe('BINARY_READ_CAPACITY_EXCEEDED');
    const aborted = waitForJson(
      workspace.socket,
      (message) => message.requestId === id && message.payload?.error === 'BINARY_READ_ABORTED',
    );
    // Handle the listener promise even if the cancellation assertion fails.
    const outcome = aborted.then(
      () => true,
      () => false,
    );
    expect(await requestWorkspace(workspace.socket, 'filesystem.cancelRead', { requestId: id })).toBe(true);
    expect(await outcome).toBe(true);
    expect((await fetch(`${E2E_SSH.controlUrl}/sftp/read-delay?ms=0`, { method: 'POST' })).ok).toBeTruthy();
    expect(
      (await requestWorkspaceBinary(workspace.socket, 'filesystem.readBinary', payload)).bytes.length,
    ).toBeGreaterThan(0);
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/read-delay?ms=0`, { method: 'POST' });
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

test('failed SFTP stream acquisition releases admission and does not poison later reads', async ({ request }) => {
  await loginAsInitialAdmin(request);
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId);
  try {
    await waitForFilesystemReady(workspace.socket);
    for (let batch = 0; batch < 3; batch++) {
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          requestWorkspaceBinary(workspace.socket, 'filesystem.readBinary', {
            path: `/missing-${crypto.randomUUID()}`,
            maxBytes: 1024,
          }).then(
            () => ({ completed: true }),
            (error: Error) => ({ error: error.message }),
          ),
        ),
      );
      for (const result of results) {
        expect(result).toMatchObject({ error: expect.stringContaining('filesystem.readBinary failed:') });
        expect('error' in result ? result.error : '').not.toContain('CAPACITY_EXCEEDED');
      }
    }
    const recovered = await Promise.all(
      Array.from({ length: 4 }, () =>
        requestWorkspaceBinary(workspace.socket, 'filesystem.readBinary', { path: '/seed.txt', maxBytes: 1024 }),
      ),
    );
    expect(recovered[0].bytes.length).toBeGreaterThan(0);
    for (const result of recovered) expect(result.bytes).toEqual(recovered[0].bytes);
  } finally {
    await closeWebSocket(workspace.socket);
  }
});

test('cancelling while SFTP OPEN is pending aborts the read and releases its slot', async ({ request }) => {
  await loginAsInitialAdmin(request);
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId);
  const id = crypto.randomUUID();
  let pending: Promise<unknown> | undefined;
  try {
    await waitForFilesystemReady(workspace.socket);
    expect((await fetch(`${E2E_SSH.controlUrl}/sftp/open-delay?ms=3000`, { method: 'POST' })).ok).toBeTruthy();
    pending = requestWorkspaceBinary(
      workspace.socket,
      'filesystem.readBinary',
      { path: '/seed.txt', maxBytes: 1024 },
      id,
    ).then(
      () => ({ completed: true }),
      (error: Error) => ({ error: error.message }),
    );
    await expect
      .poll(async () => {
        const response = await fetch(`${E2E_SSH.controlUrl}/sftp/open-delay`);
        return (await response.json()).sftpDelayedOpenCount;
      })
      .toBe(1);
    expect(await requestWorkspace(workspace.socket, 'filesystem.cancelRead', { requestId: id })).toBe(true);
    expect(await pending).toMatchObject({ error: expect.stringContaining('BINARY_READ_ABORTED') });
    expect(await requestWorkspace(workspace.socket, 'filesystem.cancelRead', { requestId: id })).toBe(false);
    expect((await fetch(`${E2E_SSH.controlUrl}/sftp/open-delay?ms=0`, { method: 'POST' })).ok).toBeTruthy();
    const recovered = await Promise.all(
      Array.from({ length: 4 }, () =>
        requestWorkspaceBinary(workspace.socket, 'filesystem.readBinary', { path: '/seed.txt', maxBytes: 1024 }),
      ),
    );
    expect(recovered[0].bytes.length).toBeGreaterThan(0);
    for (const result of recovered) expect(result.bytes).toEqual(recovered[0].bytes);
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/open-delay?ms=0`, { method: 'POST' });
    await closeWebSocket(workspace.socket);
    if (pending) await pending;
  }
});

test('a file growing after SFTP READ starts cannot exceed the admitted byte budget', async ({ request }) => {
  await loginAsInitialAdmin(request);
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId);
  const path = `/growing-${crypto.randomUUID()}.txt`;
  let pending: Promise<unknown> | undefined;
  try {
    await waitForFilesystemReady(workspace.socket);
    await requestWorkspace(workspace.socket, 'filesystem.writeText', { path, content: 'initial' });
    expect((await fetch(`${E2E_SSH.controlUrl}/sftp/read-delay?ms=3000`, { method: 'POST' })).ok).toBeTruthy();
    pending = requestWorkspaceBinary(workspace.socket, 'filesystem.readBinary', { path, maxBytes: 1024 }).then(
      (result) => ({ bytes: result.bytes }),
      (error: Error) => ({ error: error.message }),
    );
    await expect
      .poll(async () => {
        const response = await fetch(`${E2E_SSH.controlUrl}/sftp/read-delay`);
        return (await response.json()).sftpDelayedReadCount;
      })
      .toBeGreaterThan(0);
    const content = 'initial' + 'g'.repeat(8192);
    expect(
      (
        await fetch(`${E2E_SSH.controlUrl}/sftp/grow-binary-fixture?name=${encodeURIComponent(path.slice(1))}`, {
          method: 'POST',
        })
      ).ok,
    ).toBeTruthy();
    expect(await pending).toMatchObject({ bytes: Buffer.from('initial') });
    expect((await fetch(`${E2E_SSH.controlUrl}/sftp/read-delay?ms=0`, { method: 'POST' })).ok).toBeTruthy();
    await expect(
      requestWorkspaceBinary(workspace.socket, 'filesystem.readBinary', { path, maxBytes: 1024 }),
    ).rejects.toThrow('BINARY_READ_SIZE_LIMIT_EXCEEDED');
    const recovered = await requestWorkspaceBinary(workspace.socket, 'filesystem.readBinary', {
      path,
      maxBytes: Buffer.byteLength(content),
    });
    expect(recovered.bytes).toEqual(Buffer.from(content));
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/read-delay?ms=0`, { method: 'POST' });
    await closeWebSocket(workspace.socket);
    if (pending) await pending;
  }
});

test('disconnecting during pending SFTP OPEN closes the subsequently acquired remote handle', async ({ request }) => {
  await loginAsInitialAdmin(request);
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId);
  const handles = async () => {
    const response = await fetch(`${E2E_SSH.controlUrl}/sftp/read-handles`);
    expect(response.ok).toBeTruthy();
    return response.json() as Promise<{ opened: number; closed: number }>;
  };
  try {
    await waitForFilesystemReady(workspace.socket);
    const baseline = await handles();
    expect((await fetch(`${E2E_SSH.controlUrl}/sftp/open-delay?ms=3000`, { method: 'POST' })).ok).toBeTruthy();
    sendJson(workspace.socket, {
      type: 'filesystem.readBinary',
      requestId: crypto.randomUUID(),
      payload: { path: '/seed.txt', maxBytes: 1024 },
    });
    await expect
      .poll(async () => {
        const response = await fetch(`${E2E_SSH.controlUrl}/sftp/open-delay`);
        return (await response.json()).sftpDelayedOpenCount;
      })
      .toBe(1);
    await closeWebSocket(workspace.socket);
    await expect.poll(handles).toEqual({ opened: baseline.opened + 1, closed: baseline.closed + 1 });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/open-delay?ms=0`, { method: 'POST' });
    await closeWebSocket(workspace.socket);
  }
});
