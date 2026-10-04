import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, ensureTestSshConnection, resetTestSshFilesystem } from '../../support/ssh';
import { closeWebSocket, openWorkspaceSession, requestWorkspace, waitForFilesystemReady } from '../../support/ws';

test('measure recursive search on wide and deep trees under remote directory latency', async ({
  request,
}, testInfo) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const root = path.resolve('.tmp/ssh-root/search-profile');
  const expected: Record<string, string[]> = { wide: [], deep: [], skew: [] };
  for (const shape of ['wide', 'deep', 'skew']) {
    for (let i = 0; i < 24; i++) {
      const relative = shape === 'wide' ? `d${i}` : Array.from({ length: i + 1 }, (_, n) => `d${n}`).join('/');
      await mkdir(path.join(root, shape, relative), { recursive: true });
      await writeFile(path.join(root, shape, relative, 'needle.txt'), 'search fixture');
      expected[shape].push(`${relative}/needle.txt`);
    }
  }
  await mkdir(path.join(root, 'skew', 'slow'), { recursive: true });
  await writeFile(path.join(root, 'skew', 'slow', 'needle.txt'), 'slow fixture');
  expected.skew.push('slow/needle.txt');
  const workspace = await openWorkspaceSession(request, await ensureTestSshConnection(request));
  const results = [];
  try {
    await waitForFilesystemReady(workspace.socket);
    for (const delay of [0, 20, 80]) {
      expect((await fetch(`${E2E_SSH.controlUrl}/sftp/readdir-delay?ms=${delay}`, { method: 'POST' })).ok).toBeTruthy();
      for (const shape of ['wide', 'deep', 'skew']) {
        expect(
          (
            await fetch(
              `${E2E_SSH.controlUrl}/sftp/slow-directory?path=%2Fsearch-profile%2Fskew%2Fslow&ms=${shape === 'skew' ? 1500 : 0}`,
              { method: 'POST' },
            )
          ).ok,
        ).toBeTruthy();
        for (let sample = 0; sample < 3; sample++) {
          const beforeResponse = await fetch(`${E2E_SSH.controlUrl}/sftp/readdir-delay`);
          expect(beforeResponse.ok).toBe(true);
          const before = await beforeResponse.json();
          const start = performance.now();
          const response = await requestWorkspace<{ truncated: boolean; entries: Array<{ relativePath: string }> }>(
            workspace.socket,
            'filesystem.search',
            { path: `/search-profile/${shape}`, query: 'needle' },
          );
          const ms = performance.now() - start;
          expect(response.truncated).toBe(false);
          expect(response.entries.map((entry) => entry.relativePath).sort()).toEqual([...expected[shape]].sort());
          const afterResponse = await fetch(`${E2E_SSH.controlUrl}/sftp/readdir-delay`);
          expect(afterResponse.ok).toBe(true);
          const after = await afterResponse.json();
          const delayedOpens = after.sftpDelayedDirectoryOpens - before.sftpDelayedDirectoryOpens;
          expect(delayedOpens).toBe(delay ? (shape === 'skew' ? 26 : 25) : 0);
          results.push({ delay, shape, sample, ms, delayedOpens });
        }
      }
    }
    console.log('SEARCH_NETWORK_RESULT', JSON.stringify(results));
    expect((await fetch(`${E2E_SSH.controlUrl}/sftp/slow-directory?ms=0`, { method: 'POST' })).ok).toBeTruthy();
    expect((await fetch(`${E2E_SSH.controlUrl}/sftp/readdir-delay?ms=0`, { method: 'POST' })).ok).toBeTruthy();
    const bounded = path.join(root, 'bounded');
    await mkdir(bounded, { recursive: true });
    await Promise.all(
      Array.from({ length: 510 }, (_, index) => writeFile(path.join(bounded, `needle-${index}.txt`), 'bounded search')),
    );
    const truncated = await requestWorkspace<{ truncated: boolean; entries: Array<{ path: string }> }>(
      workspace.socket,
      'filesystem.search',
      { path: '/search-profile/bounded', query: 'needle' },
    );
    expect(truncated.truncated).toBe(true);
    expect(truncated.entries).toHaveLength(500);
    expect(new Set(truncated.entries.map((entry) => entry.path)).size).toBe(500);
    expect(truncated.entries.every((entry) => entry.path.startsWith('/search-profile/bounded/needle-'))).toBe(true);
    await expect(
      requestWorkspace(workspace.socket, 'filesystem.search', { path: '/search-profile/missing', query: 'needle' }),
    ).rejects.toThrow();
    const recovered = await requestWorkspace<{ truncated: boolean; entries: Array<{ relativePath: string }> }>(
      workspace.socket,
      'filesystem.search',
      { path: '/search-profile/wide', query: 'needle' },
    );
    expect(recovered.truncated).toBe(false);
    expect(recovered.entries.map((entry) => entry.relativePath).sort()).toEqual([...expected.wide].sort());
    await testInfo.attach('search-network-results', {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json',
    });
  } finally {
    try {
      expect((await fetch(`${E2E_SSH.controlUrl}/sftp/slow-directory?ms=0`, { method: 'POST' })).ok).toBe(true);
    } finally {
      try {
        expect((await fetch(`${E2E_SSH.controlUrl}/sftp/readdir-delay?ms=0`, { method: 'POST' })).ok).toBe(true);
      } finally {
        await closeWebSocket(workspace.socket);
      }
    }
  }
});
