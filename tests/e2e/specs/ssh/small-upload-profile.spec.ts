import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, ensureTestSshConnection, resetTestSshFilesystem } from '../../support/ssh';
import { E2E_URLS } from '../../support/test-env';
import {
  closeWebSocket,
  openAuthenticatedWebSocket,
  openWorkspaceSession,
  requestWorkspace,
  waitForFilesystemReady,
  waitForJson,
} from '../../support/ws';

test('profile small uploads by ready, transfer and commit phases with exact remote bytes', async ({
  request,
}, testInfo) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const workspace = await openWorkspaceSession(request, await ensureTestSshConnection(request));
  const results = [];
  try {
    await waitForFilesystemReady(workspace.socket);
    for (const writeDelayMs of [0, 60]) {
      expect((await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=${writeDelayMs}`, { method: 'POST' })).ok).toBe(
        true,
      );
      for (let sample = 0; sample < 3; sample++) {
        const uploadId = `small-${crypto.randomUUID()}`;
        const destinationPath = `/small-${uploadId}.bin`;
        const payload = Buffer.alloc(4096, sample + 1);
        const ready = waitForJson(
          workspace.socket,
          (message) =>
            message.type === 'transfer.upload' &&
            message.payload?.uploadId === uploadId &&
            message.payload?.type === 'ready',
        );
        const start = performance.now();
        await requestWorkspace(workspace.socket, 'upload.start', {
          uploadId,
          destinationPath,
          size: payload.length,
          conflictPolicy: 'overwrite',
        });
        await ready;
        const readyMs = performance.now() - start;
        const completed = waitForJson(
          workspace.socket,
          (message) =>
            message.type === 'transfer.upload' &&
            message.payload?.uploadId === uploadId &&
            message.payload?.type === 'completed',
        );
        const progress = waitForJson(
          workspace.socket,
          (message) =>
            message.type === 'transfer.upload' &&
            message.payload?.uploadId === uploadId &&
            message.payload?.type === 'progress' &&
            message.payload?.bytesWritten === payload.length,
        );
        const socket = await openAuthenticatedWebSocket(
          request,
          `${E2E_URLS.frontendWsOrigin}/ws/uploads?workspaceId=${encodeURIComponent(workspace.workspaceId)}&uploadId=${encodeURIComponent(uploadId)}&size=${payload.length}`,
        );
        try {
          const sent = performance.now();
          socket.send(payload);
          await progress;
          const written = performance.now();
          await completed;
          const ended = performance.now();
          expect(await readFile(path.resolve('.tmp/ssh-root', destinationPath.slice(1)))).toEqual(payload);
          expect(
            (await readdir(path.resolve('.tmp/ssh-root'))).some(
              (name) => name.includes(uploadId) && name.endsWith('.part'),
            ),
          ).toBe(false);
          results.push({
            writeDelayMs,
            sample,
            readyMs,
            writeMs: written - sent,
            commitMs: ended - written,
            totalMs: ended - start,
          });
        } finally {
          await closeWebSocket(socket);
        }
      }
    }
    console.log('SMALL_UPLOAD_RESULT', JSON.stringify(results));
    await testInfo.attach('small-upload-profile', {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json',
    });
  } finally {
    expect((await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' })).ok).toBe(true);
    await closeWebSocket(workspace.socket);
  }
});
