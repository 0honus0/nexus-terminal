import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, ensureTestSshConnection, resetTestSshFilesystem } from '../../support/ssh';
import {
  closeWebSocket,
  openAuthenticatedWebSocket,
  openWorkspaceSession,
  requestWorkspace,
  waitForFilesystemReady,
  waitForJson,
} from '../../support/ws';

async function readRemoteFile(socket: any, remotePath: string): Promise<Buffer> {
  const response = await requestWorkspace<{ contentBase64: string }>(socket, 'filesystem.readBinary', {
    path: remotePath,
  });
  return Buffer.from(response.contentBase64, 'base64');
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
    const payload = Buffer.from('nexus-upload-protocol\n', 'utf8');

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
      `ws://127.0.0.1:4173/ws/uploads?workspaceId=${encodeURIComponent(workspace.workspaceId)}&uploadId=${encodeURIComponent(uploadId)}&size=${payload.length}`,
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
