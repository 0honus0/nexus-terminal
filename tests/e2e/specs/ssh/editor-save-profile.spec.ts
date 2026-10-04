import { expect, test } from '../../support/fixtures';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, ensureTestSshConnection, resetTestSshFilesystem } from '../../support/ssh';
import { closeWebSocket, openWorkspaceSession, requestWorkspace, waitForFilesystemReady } from '../../support/ws';

test('profile text saves with exact bytes and temporary-file cleanup', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const remotePath = '/editor-save-profile.txt';
  const root = path.resolve('.tmp/ssh-root');
  await writeFile(path.join(root, remotePath.slice(1)), 'original\n');
  const workspace = await openWorkspaceSession(request, await ensureTestSshConnection(request));
  const control = `${E2E_SSH.controlUrl}/sftp/stat-delay`;
  const samples = [];
  try {
    await waitForFilesystemReady(workspace.socket);
    for (const delayMs of [0, 60]) {
      expect((await fetch(`${control}?ms=${delayMs}&prefix=${remotePath}`, { method: 'POST' })).ok).toBe(true);
      for (let sample = 0; sample < 10; sample++) {
        const content = `save ${delayMs}/${sample}: 中文\n${'editor content\n'.repeat(1024)}`;
        const started = performance.now();
        expect(
          await requestWorkspace(workspace.socket, 'filesystem.writeText', {
            path: remotePath,
            content,
            encoding: 'utf-8',
          }),
        ).toBeNull();
        const ms = performance.now() - started;
        expect(await readFile(path.join(root, remotePath.slice(1)))).toEqual(Buffer.from(content));
        expect((await readdir(root)).filter((name) => name.startsWith('.nexus-save-'))).toEqual([]);
        samples.push({ delayMs, sample, ms });
      }
    }
    console.log('[editor text save profile]', JSON.stringify(samples));
  } finally {
    try {
      expect((await fetch(`${control}?ms=0`, { method: 'POST' })).ok).toBe(true);
    } finally {
      await closeWebSocket(workspace.socket);
    }
  }
});
