import { expect, test } from '../../support/fixtures';
import { createHash } from 'node:crypto';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, ensureTestSshConnection, resetTestSshFilesystem } from '../../support/ssh';
import {
  closeWebSocket,
  openAuthenticatedWebSocket,
  openWorkspaceSession,
  requestWorkspace,
  requestWorkspaceBinary,
  waitForFilesystemReady,
  waitForJson,
} from '../../support/ws';
import { E2E_URLS } from '../../support/test-env';

async function readRemoteFile(socket: any, remotePath: string): Promise<Buffer> {
  const response = await requestWorkspaceBinary<{ path: string }>(socket, 'filesystem.readBinary', {
    path: remotePath,
    maxBytes: 64 * 1024 * 1024,
  });
  return response.bytes;
}

test('pipelined upload and HTTP download stay fast under SFTP latency and preserve every byte', async ({ request }) => {
  test.setTimeout(90_000);
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId, `transfer-throughput-${crypto.randomUUID()}`);
  const uploadId = `throughput-${crypto.randomUUID()}`;
  const remotePath = '/transfer-throughput.bin';
  const payload = Buffer.alloc(8 * 1024 * 1024);
  for (let offset = 0; offset < payload.length; offset++) payload[offset] = offset % 251;
  let uploadSocket: Awaited<ReturnType<typeof openAuthenticatedWebSocket>> | undefined;

  try {
    await waitForFilesystemReady(workspace.socket);
    const delayResponse = await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=60`, { method: 'POST' });
    expect(delayResponse.ok).toBe(true);
    const ready = waitForJson(
      workspace.socket,
      (message) =>
        message.type === 'transfer.upload' &&
        message.payload?.uploadId === uploadId &&
        message.payload?.type === 'ready',
      10_000,
    );
    await requestWorkspace(workspace.socket, 'upload.start', {
      uploadId,
      destinationPath: remotePath,
      size: payload.length,
      conflictPolicy: 'overwrite',
    });
    await ready;
    const completed = waitForJson(
      workspace.socket,
      (message) =>
        message.type === 'transfer.upload' &&
        message.payload?.uploadId === uploadId &&
        message.payload?.type === 'completed',
      30_000,
    );
    uploadSocket = await openAuthenticatedWebSocket(
      request,
      `${E2E_URLS.frontendWsOrigin}/ws/uploads?workspaceId=${encodeURIComponent(workspace.workspaceId)}&uploadId=${encodeURIComponent(uploadId)}&size=${payload.length}`,
    );
    const uploadStarted = performance.now();
    for (let offset = 0; offset < payload.length; offset += 512 * 1024) {
      uploadSocket.send(payload.subarray(offset, offset + 512 * 1024));
    }
    await completed;
    const uploadMs = performance.now() - uploadStarted;
    // 8MiB needs at least 256 SFTP WRITE packets at 32KiB. Waiting for
    // each packet's 60ms response costs >=15s; bounded batching must beat it.
    expect(uploadMs, 'upload must pipeline remote writes rather than serialize acknowledgements').toBeLessThan(10_000);
    await closeWebSocket(uploadSocket);

    const readDelay = await fetch(`${E2E_SSH.controlUrl}/sftp/read-delay?ms=60`, { method: 'POST' });
    expect(readDelay.ok).toBe(true);
    const ticketResponse = await request.post('/api/v1/sftp/download-ticket', {
      data: { connectionId, sessionId: workspace.workspaceId, remotePath },
    });
    expect(ticketResponse.status()).toBe(201);
    const ticket = (await ticketResponse.json()) as { url: string };
    const downloadStarted = performance.now();
    const response = await request.get(ticket.url, { timeout: 30_000 });
    expect(response.status()).toBe(200);
    const downloaded = await response.body();
    const downloadMs = performance.now() - downloadStarted;
    expect(downloaded.length).toBe(payload.length);
    expect(createHash('sha256').update(downloaded).digest('hex')).toBe(
      createHash('sha256').update(payload).digest('hex'),
    );
    await response.dispose();
    expect(downloadMs, 'download must prefetch remote reads instead of waiting for every round trip').toBeLessThan(
      8_000,
    );

    // An unaligned range spans multiple prefetch windows and must remain ordered.
    const start = 123;
    const end = 2 * 1024 * 1024 + 77;
    const ranged = await request.get(ticket.url, { headers: { Range: `bytes=${start}-${end}` } });
    expect(ranged.status()).toBe(206);
    expect(ranged.headers()['content-range']).toBe(`bytes ${start}-${end}/${payload.length}`);
    expect(await ranged.body()).toEqual(payload.subarray(start, end + 1));
    const suffixLength = 64 * 1024 + 13;
    const suffix = await request.get(ticket.url, { headers: { Range: `bytes=-${suffixLength}` } });
    expect(suffix.status()).toBe(206);
    expect(suffix.headers()['content-range']).toBe(
      `bytes ${payload.length - suffixLength}-${payload.length - 1}/${payload.length}`,
    );
    expect(await suffix.body()).toEqual(payload.subarray(-suffixLength));
    const tailStart = payload.length - 2 * 1024 * 1024 - 19;
    const tail = await request.get(ticket.url, { headers: { Range: `bytes=${tailStart}-` } });
    expect(tail.status()).toBe(206);
    expect(tail.headers()['content-range']).toBe(`bytes ${tailStart}-${payload.length - 1}/${payload.length}`);
    expect(await tail.body()).toEqual(payload.subarray(tailStart));
    const outside = await request.get(ticket.url, { headers: { Range: `bytes=${payload.length}-` } });
    expect(outside.status()).toBe(416);
    expect(outside.headers()['content-range']).toBe(`bytes */${payload.length}`);
    const recovered = await request.get(ticket.url);
    expect(recovered.status()).toBe(200);
    const recoveredBytes = await recovered.body();
    expect(recoveredBytes.length).toBe(payload.length);
    expect(createHash('sha256').update(recoveredBytes).digest('hex')).toBe(
      createHash('sha256').update(payload).digest('hex'),
    );
    await recovered.dispose();
    await test.info().attach('transfer-throughput', {
      body: JSON.stringify({ bytes: payload.length, sftpDelayMs: 60, uploadMs, downloadMs }, null, 2),
      contentType: 'application/json',
    });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' }).catch(() => undefined);
    await fetch(`${E2E_SSH.controlUrl}/sftp/read-delay?ms=0`, { method: 'POST' }).catch(() => undefined);
    if (uploadSocket) await closeWebSocket(uploadSocket).catch(() => undefined);
    await closeWebSocket(workspace.socket);
  }
});

test('raw binary upload reports ready, progress, completion, and readable remote content', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId, `upload-protocol-${crypto.randomUUID()}`);

  try {
    await waitForFilesystemReady(workspace.socket);
    const uploadId = `upload-${crypto.randomUUID()}`;
    const remotePath = '/upload-protocol.bin';
    const payload = Buffer.alloc(700 * 1024);
    for (let offset = 0; offset < payload.length; offset += 1) payload[offset] = offset % 251;

    const readyPromise = waitForJson(
      workspace.socket,
      (message) =>
        message.type === 'transfer.upload' &&
        message.payload?.uploadId === uploadId &&
        message.payload?.type === 'ready',
      10_000,
    );
    await requestWorkspace(workspace.socket, 'upload.start', {
      uploadId,
      destinationPath: remotePath,
      size: payload.length,
      conflictPolicy: 'overwrite',
    });
    await readyPromise;

    const progressPromise = waitForJson(
      workspace.socket,
      (message) =>
        message.type === 'transfer.upload' &&
        message.payload?.uploadId === uploadId &&
        message.payload?.type === 'progress',
      10_000,
    );
    const completedPromise = waitForJson(
      workspace.socket,
      (message) =>
        message.type === 'transfer.upload' &&
        message.payload?.uploadId === uploadId &&
        message.payload?.type === 'completed',
      10_000,
    );
    const uploadSocket = await openAuthenticatedWebSocket(
      request,
      `${E2E_URLS.frontendWsOrigin}/ws/uploads?workspaceId=${encodeURIComponent(workspace.workspaceId)}&uploadId=${encodeURIComponent(uploadId)}&size=${payload.length}`,
    );
    uploadSocket.send(payload);

    await expect(progressPromise).resolves.toMatchObject({
      payload: {
        uploadId,
        bytesWritten: payload.length,
        totalSize: payload.length,
        progress: 100,
      },
    });
    await expect(completedPromise).resolves.toMatchObject({
      payload: { uploadId, type: 'completed', destinationPath: remotePath },
    });
    await closeWebSocket(uploadSocket);
    await expect(readRemoteFile(workspace.socket, remotePath)).resolves.toEqual(payload);
  } finally {
    await closeWebSocket(workspace.socket);
  }
});

test('cancelling pipelined remote writes preserves the destination and permits a fresh upload', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId, `upload-write-cancel-${crypto.randomUUID()}`);
  const destinationPath = '/pipeline-cancel.bin';
  const original = 'Existing destination must survive cancellation.';
  const payload = Buffer.alloc(2 * 1024 * 1024, 0x5a);
  let uploadSocket: Awaited<ReturnType<typeof openAuthenticatedWebSocket>> | undefined;
  try {
    await waitForFilesystemReady(workspace.socket);
    await requestWorkspace(workspace.socket, 'filesystem.writeText', { path: destinationPath, content: original });
    for (const cancel of [true, false]) {
      const uploadId = `pipeline-cancel-${crypto.randomUUID()}`;
      const delay = await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=${cancel ? 1200 : 0}`, { method: 'POST' });
      expect(delay.ok).toBeTruthy();
      const ready = waitForJson(
        workspace.socket,
        (message) =>
          message.type === 'transfer.upload' &&
          message.payload?.uploadId === uploadId &&
          message.payload?.type === 'ready',
      );
      await requestWorkspace(workspace.socket, 'upload.start', {
        uploadId,
        destinationPath,
        size: payload.length,
        conflictPolicy: 'overwrite',
      });
      await ready;
      const terminal = waitForJson(
        workspace.socket,
        (message) =>
          message.type === 'transfer.upload' &&
          message.payload?.uploadId === uploadId &&
          ['completed', 'cancelled', 'failed'].includes(String(message.payload?.type)),
      );
      uploadSocket = await openAuthenticatedWebSocket(
        request,
        `${E2E_URLS.frontendWsOrigin}/ws/uploads?workspaceId=${encodeURIComponent(workspace.workspaceId)}&uploadId=${encodeURIComponent(uploadId)}&size=${payload.length}`,
      );
      // Multiple buffered chunks are required to enter SFTP's batched write path;
      // a single chunk uses its ordinary serialized _write implementation.
      const sentBytes = cancel ? payload.length / 2 : payload.length;
      for (let offset = 0; offset < sentBytes; offset += 64 * 1024) {
        uploadSocket.send(payload.subarray(offset, offset + 64 * 1024));
      }
      if (cancel) {
        await expect
          .poll(async () => {
            const state = await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay`);
            expect(state.ok).toBeTruthy();
            return (await state.json()).sftpPendingWrites;
          })
          .toBeGreaterThan(1);
        expect(await requestWorkspace(workspace.socket, 'upload.cancel', { uploadId })).toBe(true);
      }
      expect((await terminal).payload.type).toBe(cancel ? 'cancelled' : 'completed');
      await closeWebSocket(uploadSocket);
      uploadSocket = undefined;
      await expect
        .poll(async () => {
          const state = await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay`);
          expect(state.ok).toBeTruthy();
          return (await state.json()).sftpPendingWrites;
        })
        .toBe(0);
      await expect(
        requestWorkspace(workspace.socket, 'filesystem.stat', { path: `/.nexus-upload-${uploadId}.part` }),
      ).rejects.toThrow();
      expect(await readRemoteFile(workspace.socket, destinationPath)).toEqual(cancel ? Buffer.from(original) : payload);
    }
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
    if (uploadSocket) await closeWebSocket(uploadSocket);
    await closeWebSocket(workspace.socket);
  }
});

test('upload cancelled during pending start never becomes active after delayed remote open', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId, `upload-pending-cancel-${crypto.randomUUID()}`);
  const uploadId = `pending-cancel-${crypto.randomUUID()}`;
  const remotePath = '/pending-start-cancel.bin';
  const temporaryPath = `/.nexus-upload-${uploadId}.part`;

  await fetch(`${E2E_SSH.controlUrl}/sftp/stat-delay?ms=1500`, { method: 'POST' });
  try {
    await waitForFilesystemReady(workspace.socket);
    const cancelledEvent = waitForJson(
      workspace.socket,
      (message) =>
        message.type === 'transfer.upload' &&
        message.payload?.uploadId === uploadId &&
        message.payload?.type === 'cancelled',
      5_000,
    );
    const forbiddenTerminalEvent = waitForJson(
      workspace.socket,
      (message) =>
        message.type === 'transfer.upload' &&
        message.payload?.uploadId === uploadId &&
        ['ready', 'completed'].includes(String(message.payload?.type)),
      2_500,
    ).then(
      () => true,
      () => false,
    );

    const startPromise = requestWorkspace(workspace.socket, 'upload.start', {
      uploadId,
      destinationPath: remotePath,
      size: 4096,
      conflictPolicy: 'overwrite',
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    await expect(requestWorkspace<boolean>(workspace.socket, 'upload.cancel', { uploadId })).resolves.toBe(true);
    await expect(cancelledEvent).resolves.toMatchObject({ payload: { uploadId, type: 'cancelled' } });
    await expect(startPromise).resolves.toEqual({ started: true });
    await expect(forbiddenTerminalEvent).resolves.toBe(false);
    await expect(requestWorkspace(workspace.socket, 'filesystem.stat', { path: remotePath })).rejects.toThrow();
    await expect(requestWorkspace(workspace.socket, 'filesystem.stat', { path: temporaryPath })).rejects.toThrow();
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/stat-delay?ms=0`, { method: 'POST' });
    await closeWebSocket(workspace.socket);
  }
});

test('stale upload data after workspace close cannot terminate the backend', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId, `stale-upload-${crypto.randomUUID()}`);
  const uploadId = `stale-upload-${crypto.randomUUID()}`;
  const payload = Buffer.alloc(64 * 1024, 0x5a);
  let uploadSocket: any;

  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=1200`, { method: 'POST' });
  try {
    await waitForFilesystemReady(workspace.socket);
    const ready = waitForJson(
      workspace.socket,
      (message) =>
        message.type === 'transfer.upload' &&
        message.payload?.uploadId === uploadId &&
        message.payload?.type === 'ready',
      10_000,
    );
    await requestWorkspace(workspace.socket, 'upload.start', {
      uploadId,
      destinationPath: '/stale-upload.bin',
      size: payload.length * 2,
      conflictPolicy: 'overwrite',
    });
    await ready;
    uploadSocket = await openAuthenticatedWebSocket(
      request,
      `${E2E_URLS.frontendWsOrigin}/ws/uploads?workspaceId=${encodeURIComponent(workspace.workspaceId)}&uploadId=${encodeURIComponent(uploadId)}&size=${payload.length * 2}`,
    );

    // Keep the dedicated upload socket idle until the owning Workspace has been fully cleaned up.
    // This reproduces the browser race where upload.start/WS upgrade won, but its first file chunk
    // arrives only after the Workspace control socket has gone away.
    await closeWebSocket(workspace.socket);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(uploadSocket.readyState).toBe(1);

    // The stale socket must be contained locally. Current broken code lets WorkspaceSessionRegistry
    // throw synchronously out of the ws "message" callback, which the backend treats as fatal.
    uploadSocket.send(payload);
    await new Promise((resolve) => setTimeout(resolve, 250));

    // A fatal uncaughtException kills the backend here. Prove the process stayed healthy by opening
    // a completely new Workspace and reaching its filesystem over the same backend process.
    const replacement = await openWorkspaceSession(request, connectionId, `after-stale-upload-${crypto.randomUUID()}`);
    try {
      await waitForFilesystemReady(replacement.socket);
      await expect(requestWorkspace(replacement.socket, 'filesystem.list', { path: '/' })).resolves.toBeTruthy();
    } finally {
      await closeWebSocket(replacement.socket);
    }
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' }).catch(() => undefined);
    await closeWebSocket(uploadSocket).catch(() => undefined);
    await closeWebSocket(workspace.socket).catch(() => undefined);
  }
});
