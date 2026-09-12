import { expect, test } from '../../support/fixtures';
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
  });
  return response.bytes;
}

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
