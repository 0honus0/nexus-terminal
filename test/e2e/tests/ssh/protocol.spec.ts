import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, ensureTestSshConnection, resetTestSshFilesystem } from '../../support/ssh';
import {
  closeWebSocket,
  type E2eWebSocket,
  openWorkspaceSession,
  requestWorkspace,
  waitForBinaryText,
  waitForJson,
  waitForFilesystemReady,
} from '../../support/ws';
import { step } from '../../support/steps';

type ArchiveResult = {
  type: 'completed' | 'failed' | 'cancelled';
  requestId: string;
  code?: string;
  message?: string;
  path?: string;
};

const runArchive = async (
  socket: E2eWebSocket,
  operation: 'compress' | 'decompress',
  payload: Record<string, unknown>,
): Promise<ArchiveResult> => {
  const requestId = `archive-${crypto.randomUUID()}`;
  const eventPromise = waitForJson(
    socket,
    (message) =>
      message.type === 'transfer.archive' &&
      message.payload?.requestId === requestId &&
      ['completed', 'failed', 'cancelled'].includes(String(message.payload?.type)),
    30_000,
  );
  await requestWorkspace(socket, `transfer.${operation}`, payload, requestId, 30_000);
  return (await eventPromise).payload as ArchiveResult;
};

const readRemoteText = async (socket: E2eWebSocket, path: string): Promise<string> =>
  (
    await requestWorkspace<{ content: string }>(socket, 'filesystem.readText', {
      path,
      encoding: 'utf-8',
    })
  ).content;

const rootFileNames = async (socket: E2eWebSocket): Promise<string[]> =>
  (
    await requestWorkspace<{ entries: Array<{ name: string }> }>(socket, 'filesystem.list', {
      path: '/',
    })
  ).entries.map((item) => item.name);

test('backend can authenticate to the real SSH test server', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();

  const response = await request.post('/api/v1/connections/test-unsaved', {
    data: {
      name: E2E_SSH.name,
      type: 'SSH',
      host: E2E_SSH.host,
      port: E2E_SSH.port,
      username: E2E_SSH.username,
      authMethod: 'password',
      password: E2E_SSH.password,
    },
  });

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toMatchObject({ success: true });
});

test('duplicate workspace.connect is rejected without breaking filesystem access', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId, `duplicate-${crypto.randomUUID()}`);

  try {
    await waitForFilesystemReady(workspace.socket);
    await step('repeat workspace.connect on the same live websocket', async () => {
      await expect(
        requestWorkspace(workspace.socket, 'workspace.connect', {
          connectionId,
          workspaceId: `duplicate-second-${crypto.randomUUID()}`,
        }),
      ).rejects.toThrow(/already bound/i);
    });

    await step('filesystem operations still work after the rejected duplicate request', async () => {
      const root = await requestWorkspace<{ entries: Array<{ name: string }> }>(workspace.socket, 'filesystem.list', {
        path: '/',
      });
      expect(root.entries.map((item) => item.name)).toContain('seed.txt');
    });
  } finally {
    await closeWebSocket(workspace.socket);
  }
});

test('recursive filesystem search stays scoped to the requested path and returns nested paths', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId, `search-${crypto.randomUUID()}`);

  try {
    await waitForFilesystemReady(workspace.socket);

    const rootSearch = await requestWorkspace<{
      truncated: boolean;
      entries: Array<{ name: string; relativePath: string; path: string }>;
    }>(workspace.socket, 'filesystem.search', { path: '/', query: 'nested' });
    expect(rootSearch).toMatchObject({
      truncated: false,
      entries: expect.arrayContaining([
        expect.objectContaining({
          name: 'nested.txt',
          relativePath: 'folder-seed/nested.txt',
          path: '/folder-seed/nested.txt',
        }),
      ]),
    });

    const scopedSearch = await requestWorkspace<{ entries: unknown[] }>(workspace.socket, 'filesystem.search', {
      path: '/folder-seed',
      query: 'seed.txt',
    });
    expect(scopedSearch.entries).toEqual([]);
  } finally {
    await closeWebSocket(workspace.socket);
  }
});

test('raw terminal output needs no acknowledgement and clean requests remain usable', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId, `raw-terminal-${crypto.randomUUID()}`);

  try {
    const outputPromise = waitForBinaryText(workspace.socket, 'RAW_TERMINAL_E2E', 15_000);
    await requestWorkspace(workspace.socket, 'terminal.input', { data: "printf 'RAW_TERMINAL_E2E\\n'\r" });
    await expect(outputPromise).resolves.toContain('RAW_TERMINAL_E2E');
    await expect(requestWorkspace(workspace.socket, 'suspend.list')).resolves.toEqual(expect.any(Array));
  } finally {
    await closeWebSocket(workspace.socket);
  }
});

test('same-workspace move treats a missing destination path as available', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId, `move-${crypto.randomUUID()}`);

  try {
    await waitForFilesystemReady(workspace.socket);
    await step('move a file into an existing directory', async () => {
      const requestId = `move-${crypto.randomUUID()}`;
      const completed = waitForJson(
        workspace.socket,
        (message) =>
          message.type === 'transfer.copyMove' &&
          message.payload?.requestId === requestId &&
          message.payload?.type === 'completed',
        20_000,
      );
      await requestWorkspace(
        workspace.socket,
        'transfer.copyMove',
        { mode: 'move', sources: ['/move-source.txt'], destination: '/folder-seed' },
        requestId,
      );
      await completed;

      const destination = await requestWorkspace<{ content: string }>(workspace.socket, 'filesystem.readText', {
        path: '/folder-seed/move-source.txt',
        encoding: 'utf-8',
      });
      expect(destination.content).toContain('move-me');

      const root = await requestWorkspace<{ entries: Array<{ name: string }> }>(workspace.socket, 'filesystem.list', {
        path: '/',
      });
      expect(root.entries.map((item) => item.name)).not.toContain('move-source.txt');
    });
  } finally {
    await closeWebSocket(workspace.socket);
  }
});

test('archive commands use the same remote root as filesystem operations', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId, `archive-${crypto.randomUUID()}`);

  try {
    await waitForFilesystemReady(workspace.socket);
    await step('compress and decompress a file in the filesystem root', async () => {
      const compressed = await runArchive(workspace.socket, 'compress', {
        sources: ['/archive-source.txt'],
        destination: '/archive-source.zip',
        format: 'zip',
      });
      test.skip(compressed.code === 'COMMAND_NOT_FOUND', 'zip is not installed in this test environment');
      expect(compressed.type, JSON.stringify(compressed)).toBe('completed');

      await requestWorkspace(workspace.socket, 'filesystem.remove', { paths: ['/archive-source.txt'] });

      const decompressed = await runArchive(workspace.socket, 'decompress', { source: '/archive-source.zip' });
      test.skip(decompressed.code === 'COMMAND_NOT_FOUND', 'unzip is not installed in this test environment');
      expect(decompressed.type).toBe('completed');
      await expect(readRemoteText(workspace.socket, '/archive-source.txt')).resolves.toContain('archive-me');
    });
  } finally {
    await closeWebSocket(workspace.socket);
  }
});

test('ZIP Unicode Path entries extract Chinese filenames instead of escaped placeholders', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId, `archive-unicode-${crypto.randomUUID()}`);

  try {
    await waitForFilesystemReady(workspace.socket);
    const response = await runArchive(workspace.socket, 'decompress', { source: '/中文解压测试.zip' });
    test.skip(response.code === 'COMMAND_NOT_FOUND', 'unzip is not installed in this test environment');
    expect(response.type).toBe('completed');

    await expect(readRemoteText(workspace.socket, '/中文解压测试')).resolves.toContain('unicode-path-e2e');
    const filenames = await rootFileNames(workspace.socket);
    expect(filenames).toContain('中文解压测试');
    expect(filenames).not.toContain('#U4e2d#U6587#U89e3#U538b#U6d4b#U8bd5');
  } finally {
    await closeWebSocket(workspace.socket);
  }
});

test('password-protected ZIP validates passwords and preserves the normal decompress flow', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId, `archive-password-${crypto.randomUUID()}`);
  const specialPassword = 'Nexus !@#$%^&*()_+-=[]{};:\'",.<>/?\\|`~';
  const maxPassword = 'x'.repeat(128);

  try {
    await waitForFilesystemReady(workspace.socket);

    await step('create a password-protected ZIP with shell-special characters', async () => {
      const response = await runArchive(workspace.socket, 'compress', {
        sources: ['/archive-source.txt'],
        destination: '/archive-special.zip',
        format: 'zip',
        password: specialPassword,
      });
      test.skip(response.code === 'COMMAND_NOT_FOUND', 'zip is not installed in this test environment');
      expect(response.type).toBe('completed');
      await requestWorkspace(workspace.socket, 'filesystem.remove', { paths: ['/archive-source.txt'] });
    });

    await step('decompress without a password reports PASSWORD_REQUIRED without extracting files', async () => {
      const response = await runArchive(workspace.socket, 'decompress', { source: '/archive-special.zip' });
      test.skip(response.code === 'COMMAND_NOT_FOUND', 'unzip is not installed in this test environment');
      expect(response).toMatchObject({ type: 'failed', code: 'PASSWORD_REQUIRED' });
      expect(await rootFileNames(workspace.socket)).not.toContain('archive-source.txt');
    });

    await step('wrong password reports INVALID_PASSWORD and correct special-character password succeeds', async () => {
      await expect(
        runArchive(workspace.socket, 'decompress', {
          source: '/archive-special.zip',
          password: 'definitely-wrong',
        }),
      ).resolves.toMatchObject({ type: 'failed', code: 'INVALID_PASSWORD' });

      const correctResponse = await runArchive(workspace.socket, 'decompress', {
        source: '/archive-special.zip',
        password: specialPassword,
      });
      expect(correctResponse.type).toBe('completed');
      await expect(readRemoteText(workspace.socket, '/archive-source.txt')).resolves.toContain('archive-me');
    });

    await step('128-character password is accepted and round-trips', async () => {
      const compressed = await runArchive(workspace.socket, 'compress', {
        sources: ['/archive-source.txt'],
        destination: '/archive-max-password.zip',
        format: 'zip',
        password: maxPassword,
      });
      expect(compressed.type, JSON.stringify(compressed)).toBe('completed');
      await requestWorkspace(workspace.socket, 'filesystem.remove', { paths: ['/archive-source.txt'] });
      const decompressed = await runArchive(workspace.socket, 'decompress', {
        source: '/archive-max-password.zip',
        password: maxPassword,
      });
      expect(decompressed.type).toBe('completed');
    });

    await step('129-character and line-break passwords are rejected before shell execution', async () => {
      await expect(
        runArchive(workspace.socket, 'compress', {
          sources: ['/archive-source.txt'],
          destination: '/archive-too-long.zip',
          format: 'zip',
          password: 'x'.repeat(129),
        }),
      ).resolves.toMatchObject({ type: 'failed', code: 'PASSWORD_TOO_LONG' });

      await expect(
        runArchive(workspace.socket, 'compress', {
          sources: ['/archive-source.txt'],
          destination: '/archive-invalid-password.zip',
          format: 'zip',
          password: 'line-one\nline-two',
        }),
      ).resolves.toMatchObject({ type: 'failed', code: 'INVALID_PASSWORD_FORMAT' });

      await expect(
        runArchive(workspace.socket, 'compress', {
          sources: ['/archive-source.txt'],
          destination: '/archive-null-password.zip',
          format: 'zip',
          password: `before${String.fromCharCode(0)}after`,
        }),
      ).resolves.toMatchObject({ type: 'failed', code: 'INVALID_PASSWORD_FORMAT' });
    });
  } finally {
    await closeWebSocket(workspace.socket);
  }
});
