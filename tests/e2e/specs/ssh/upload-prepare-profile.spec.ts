import { mkdir, stat, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, ensureTestSshConnection, resetTestSshFilesystem } from '../../support/ssh';
import {
  closeWebSocket,
  openWorkspaceSession,
  requestWorkspace,
  waitForFilesystemReady,
  waitForJson,
} from '../../support/ws';

test('profile upload directory preparation and verify every requested directory', async ({ request }, testInfo) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const workspace = await openWorkspaceSession(request, await ensureTestSshConnection(request));
  const results = [];
  try {
    await waitForFilesystemReady(workspace.socket);
    for (const delayMs of [0, 80]) {
      for (const shape of ['existing', 'siblings', 'nested', 'nested-parents']) {
        for (let sample = 0; sample < 3; sample++) {
          const basePath = `/prepare-profile-${delayMs}-${shape}-${sample}`;
          const directories = Array.from({ length: 32 }, (_, index) =>
            shape.startsWith('nested') ? `parent-${Math.floor(index / 4)}/child-${index}` : `child-${index}`,
          );
          if (shape === 'nested-parents')
            directories.unshift(...Array.from({ length: 8 }, (_, index) => `parent-${index}`));
          const localRoot = path.resolve('.tmp/ssh-root', basePath.slice(1));
          if (shape === 'existing') {
            await Promise.all(
              directories.map((directory) => mkdir(path.join(localRoot, directory), { recursive: true })),
            );
          }
          expect((await fetch(`${E2E_SSH.controlUrl}/sftp/prepare-profile?ms=${delayMs}`, { method: 'POST' })).ok).toBe(
            true,
          );
          const start = performance.now();
          await requestWorkspace(workspace.socket, 'upload.prepare', {
            prepareId: crypto.randomUUID(),
            basePath,
            directories,
          });
          const ms = performance.now() - start;
          for (const directory of directories)
            expect((await stat(path.join(localRoot, directory))).isDirectory()).toBe(true);
          const metrics = await fetch(`${E2E_SSH.controlUrl}/sftp/prepare-profile`);
          expect(metrics.ok).toBe(true);
          results.push({ delayMs, shape, sample, directories: directories.length, ms, ...(await metrics.json()) });
        }
      }
    }
    console.log('UPLOAD_PREPARE_RESULT', JSON.stringify(results));
    await testInfo.attach('upload-prepare-profile', {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json',
    });
  } finally {
    expect((await fetch(`${E2E_SSH.controlUrl}/sftp/prepare-profile?ms=0`, { method: 'POST' })).ok).toBe(true);
    await closeWebSocket(workspace.socket);
  }
});

test('unclassified preparation failure retains quarantine after the remote error is removed', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  // Dedicated fixture connection prevents intentional quarantine affecting other tests.
  const connection = await request.post('/api/v1/connections', {
    data: {
      name: `prepare-quarantine-${crypto.randomUUID()}`,
      type: 'SSH',
      host: E2E_SSH.host,
      port: E2E_SSH.port,
      username: E2E_SSH.username,
      authMethod: 'password',
      password: E2E_SSH.password,
    },
  });
  expect(connection.status()).toBe(201);
  const workspace = await openWorkspaceSession(request, (await connection.json()).connection.id);
  const control = `${E2E_SSH.controlUrl}/sftp/lstat-deny-prefix`;
  try {
    await waitForFilesystemReady(workspace.socket);
    expect((await fetch(`${control}?path=%2Fprepare-profile-unknown`, { method: 'POST' })).ok).toBe(true);
    await expect(
      requestWorkspace(workspace.socket, 'upload.prepare', {
        prepareId: crypto.randomUUID(),
        basePath: '/prepare-profile-unknown',
        directories: ['child'],
      }),
    ).rejects.toThrow();
    expect((await fetch(`${control}?path=`, { method: 'POST' })).ok).toBe(true);
    await expect(
      requestWorkspace(workspace.socket, 'upload.prepare', {
        prepareId: crypto.randomUUID(),
        basePath: '/prepare-profile-unknown',
        directories: ['child'],
      }),
    ).rejects.toThrow('RESOURCE_QUARANTINED');
  } finally {
    expect((await fetch(`${control}?path=`, { method: 'POST' })).ok).toBe(true);
    await closeWebSocket(workspace.socket);
  }
});

test('implicit preparation parents stay outside destination allowlist and failed preparation recovers', async ({
  request,
}) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const workspace = await openWorkspaceSession(request, await ensureTestSshConnection(request));
  const basePath = '/prepare-profile-boundary';
  const localRoot = path.resolve('.tmp/ssh-root', basePath.slice(1));
  const prepareId = crypto.randomUUID();
  try {
    await waitForFilesystemReady(workspace.socket);
    await mkdir(localRoot, { recursive: true });
    await writeFile(path.join(localRoot, 'parent'), 'not a directory');
    await expect(
      requestWorkspace(workspace.socket, 'upload.prepare', {
        prepareId,
        basePath,
        directories: ['aaa-created', 'parent/child'],
      }),
    ).rejects.toThrow();
    // A sibling worker may already have created a directory: its acknowledged
    // outcome must drain before the known conflict is released, not be rolled back.
    expect((await stat(path.join(localRoot, 'aaa-created'))).isDirectory()).toBe(true);
    await unlink(path.join(localRoot, 'parent'));
    await requestWorkspace(workspace.socket, 'upload.prepare', {
      prepareId,
      basePath,
      directories: ['aaa-created', 'parent/child'],
    });
    expect((await stat(path.join(localRoot, 'parent/child'))).isDirectory()).toBe(true);
    for (const destinationPath of [
      `${basePath}/parent/rejected.bin`,
      `${basePath}/sibling/rejected.bin`,
      '/outside-prepared.bin',
    ]) {
      const uploadId = crypto.randomUUID();
      const failed = waitForJson(
        workspace.socket,
        (message) =>
          message.type === 'transfer.upload' &&
          message.payload?.uploadId === uploadId &&
          message.payload?.type === 'failed',
      );
      await requestWorkspace(workspace.socket, 'upload.start', {
        uploadId,
        prepareId,
        destinationPath,
        size: 1,
        conflictPolicy: 'overwrite',
      });
      expect((await failed).payload.message).toContain('outside prepared directories');
    }
    const uploadId = crypto.randomUUID();
    const ready = waitForJson(
      workspace.socket,
      (message) =>
        message.type === 'transfer.upload' &&
        message.payload?.uploadId === uploadId &&
        message.payload?.type === 'ready',
    );
    await requestWorkspace(workspace.socket, 'upload.start', {
      uploadId,
      prepareId,
      destinationPath: `${basePath}/parent/child/allowed.bin`,
      size: 1,
      conflictPolicy: 'overwrite',
    });
    await ready;
    const cancelled = waitForJson(
      workspace.socket,
      (message) =>
        message.type === 'transfer.upload' &&
        message.payload?.uploadId === uploadId &&
        message.payload?.type === 'cancelled',
    );
    await requestWorkspace(workspace.socket, 'upload.cancel', { uploadId });
    await cancelled;
    await expect(stat(path.join(localRoot, 'parent/child', `.nexus-upload-${uploadId}.part`))).rejects.toThrow();
  } finally {
    await closeWebSocket(workspace.socket);
  }
});
