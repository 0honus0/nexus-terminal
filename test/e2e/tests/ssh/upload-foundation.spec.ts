import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { ensureTestSshConnection, resetTestSshFilesystem } from '../../support/ssh';
import {
  closeWebSocket,
  openSshSession,
  requestJson,
  sendJson,
  waitForJson,
  waitForSftpReady,
} from '../../support/ws';

function encodeUploadChunk(uploadId: string, chunkIndex: number, data: Buffer, isLast: boolean): Buffer {
  const uploadIdBytes = Buffer.from(uploadId, 'utf8');
  const frame = Buffer.allocUnsafe(12 + uploadIdBytes.length + data.length);
  frame.write('NXUP', 0, 4, 'ascii');
  frame.writeUInt8(1, 4);
  frame.writeUInt8(isLast ? 1 : 0, 5);
  frame.writeUInt16BE(uploadIdBytes.length, 6);
  frame.writeUInt32BE(chunkIndex, 8);
  uploadIdBytes.copy(frame, 12);
  data.copy(frame, 12 + uploadIdBytes.length);
  return frame;
}

async function readRemoteFile(socket: any, remotePath: string): Promise<Buffer> {
  const response = await requestJson(
    socket,
    'sftp:readfile',
    { path: remotePath, encoding: 'utf8' },
    'sftp:readfile:success',
    'sftp:readfile:error',
  );
  return Buffer.from(String(response.payload?.rawContentBase64 ?? ''), 'base64');
}

test('upload operation emits ready, chunk ack and success over the shared Workspace adapter', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const session = await openSshSession(request, connectionId, `upload-foundation-${crypto.randomUUID()}`);

  try {
    await waitForSftpReady(session.socket);
    const uploadId = `upload-${crypto.randomUUID()}`;
    const remotePath = '/upload-foundation.bin';
    const payload = Buffer.from('nexus-upload-foundation\n', 'utf8');

    const ready = waitForJson(
      session.socket,
      (message) => message.type === 'sftp:upload:ready' && message.payload?.uploadId === uploadId,
      10_000,
    );
    sendJson(session.socket, {
      type: 'sftp:upload:start',
      payload: { uploadId, remotePath, size: payload.length, conflictPolicy: 'overwrite' },
    });
    await ready;

    const ack = waitForJson(
      session.socket,
      (message) => message.type === 'sftp:upload:chunk:ack' && message.uploadId === uploadId,
      10_000,
    );
    const success = waitForJson(
      session.socket,
      (message) => message.type === 'sftp:upload:success' && message.uploadId === uploadId,
      10_000,
    );
    session.socket.send(encodeUploadChunk(uploadId, 0, payload, true));

    await expect(ack).resolves.toMatchObject({
      payload: {
        uploadId,
        chunkIndex: 0,
        bytesWritten: payload.length,
        totalSize: payload.length,
        progress: 100,
      },
    });
    await expect(success).resolves.toMatchObject({ path: remotePath });
    await expect(readRemoteFile(session.socket, remotePath)).resolves.toEqual(payload);
  } finally {
    await closeWebSocket(session.socket);
  }
});
