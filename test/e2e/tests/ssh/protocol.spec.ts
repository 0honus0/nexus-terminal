import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, ensureTestSshConnection, resetTestSshFilesystem, setTestSshOnline } from '../../support/ssh';
import {
  closeWebSocket,
  openAuthenticatedWebSocket,
  openSshSession,
  requestJson,
  sendJson,
  waitForJson,
  waitForSftpReady,
} from '../../support/ws';
import { step } from '../../support/steps';

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
      auth_method: 'password',
      password: E2E_SSH.password,
    },
  });

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toMatchObject({ success: true });
});

test('duplicate ssh:connect stays non-fatal and leaves SFTP usable', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const session = await openSshSession(request, connectionId, `duplicate-${crypto.randomUUID()}`);

  try {
    await waitForSftpReady(session.socket);
    await step('repeat ssh:connect on the same live websocket', async () => {
      const infoPromise = waitForJson(
        session.socket,
        (message) => message.type === 'info' && String(message.payload ?? '').includes('重复连接请求'),
        10_000,
      );
      sendJson(session.socket, {
        type: 'ssh:connect',
        payload: { connectionId: String(connectionId), clientSessionId: session.sessionId },
      });
      await infoPromise;
    });

    await step('SFTP operations still work after the duplicate request', async () => {
      const root = await requestJson(
        session.socket,
        'sftp:readdir',
        { path: '/' },
        'sftp:readdir:success',
        'sftp:readdir:error',
      );
      expect((Array.isArray(root.payload) ? root.payload : []).map((item: { filename?: string }) => item.filename))
        .toContain('seed.txt');
    });
  } finally {
    await closeWebSocket(session.socket);
  }
});

test('late terminal ACK after remote SSH disconnect is non-fatal', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const socket = await openAuthenticatedWebSocket(
    request,
    'ws://127.0.0.1:4173/ws',
    { autoAcknowledgeTerminalFrames: false },
  );
  const clientSessionId = `late-ack-${crypto.randomUUID()}`;

  try {
    const terminalFramePromise = new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.off('message', onMessage);
        reject(new Error('Timed out waiting for terminal binary frame'));
      }, 10_000);
      const onMessage = (data: Buffer, isBinary: boolean) => {
        if (!isBinary || data.length < 16 || data.subarray(0, 4).toString('ascii') !== 'NXTM') return;
        clearTimeout(timeout);
        socket.off('message', onMessage);
        resolve(data.readUInt32BE(12));
      };
      socket.on('message', onMessage);
    });

    const connectedPromise = waitForJson(socket, (message) => message.type === 'ssh:connected', 20_000);
    sendJson(socket, {
      type: 'ssh:connect',
      payload: { connectionId: String(connectionId), clientSessionId },
    });
    await connectedPromise;
    sendJson(socket, { type: 'ssh:input', payload: { data: "printf 'LATE_ACK_E2E\\n'\r" } });
    const delayedSequence = await terminalFramePromise;

    const disconnectedPromise = waitForJson(socket, (message) => message.type === 'ssh:disconnected', 15_000);
    await setTestSshOnline(false);
    await disconnectedPromise;

    const genericErrors: string[] = [];
    const onJsonMessage = (data: Buffer, isBinary: boolean) => {
      if (isBinary) return;
      try {
        const message = JSON.parse(data.toString('utf8')) as { type?: string; payload?: unknown };
        if (message.type === 'error') genericErrors.push(String(message.payload ?? ''));
      } catch {
        // Ignore non-JSON frames; this listener only observes protocol errors.
      }
    };
    socket.on('message', onJsonMessage);

    const listPromise = waitForJson(socket, (message) => message.type === 'SSH_SUSPEND_LIST_RESPONSE', 10_000);
    sendJson(socket, { type: 'ssh:output:ack', payload: { sequence: delayedSequence } });
    sendJson(socket, { type: 'SSH_SUSPEND_LIST_REQUEST', payload: {} });
    await listPromise;
    socket.off('message', onJsonMessage);

    expect(genericErrors).not.toContain('处理消息时发生内部错误: 无效的终端输出 ACK');
  } finally {
    await setTestSshOnline(true);
    await closeWebSocket(socket);
  }
});

test('same-session move treats a missing destination path as available', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const session = await openSshSession(request, connectionId, `move-${crypto.randomUUID()}`);

  try {
    await waitForSftpReady(session.socket);
    await step('move a file into an existing directory', async () => {
      await requestJson(
        session.socket,
        'sftp:move',
        { sources: ['/move-source.txt'], destination: '/folder-seed' },
        'sftp:move:success',
        'sftp:move:error',
      );

      const destination = await requestJson(
        session.socket,
        'sftp:readfile',
        { path: '/folder-seed/move-source.txt', encoding: 'utf8' },
        'sftp:readfile:success',
        'sftp:readfile:error',
      );
      expect(Buffer.from(String(destination.payload?.rawContentBase64 ?? ''), 'base64').toString('utf8'))
        .toContain('move-me');

      const root = await requestJson(
        session.socket,
        'sftp:readdir',
        { path: '/' },
        'sftp:readdir:success',
        'sftp:readdir:error',
      );
      expect((Array.isArray(root.payload) ? root.payload : []).map((item: { filename?: string }) => item.filename))
        .not.toContain('move-source.txt');
    });
  } finally {
    await closeWebSocket(session.socket);
  }
});

test('archive commands use the same remote root as SFTP', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const session = await openSshSession(request, connectionId, `archive-${crypto.randomUUID()}`);

  try {
    await waitForSftpReady(session.socket);
    await step('compress and decompress a file in the SFTP root', async () => {
      const compressRequestId = `archive-compress-${crypto.randomUUID()}`;
      const compressResponsePromise = waitForJson(
        session.socket,
        (message) => message.requestId === compressRequestId
          && ['sftp:compress:success', 'sftp:compress:error', 'sftp:command_not_found'].includes(String(message.type)),
        30_000,
      );
      sendJson(session.socket, {
        type: 'sftp:compress',
        requestId: compressRequestId,
        payload: { sources: ['/archive-source.txt'], destination: '/archive-source.zip', format: 'zip' },
      });
      const compressResponse = await compressResponsePromise;
      test.skip(compressResponse.type === 'sftp:command_not_found', 'zip is not installed in this test environment');
      expect(compressResponse.type).toBe('sftp:compress:success');

      await requestJson(
        session.socket,
        'sftp:delete_paths',
        { paths: ['/archive-source.txt'] },
        'sftp:delete_paths:success',
        'sftp:delete_paths:error',
      );

      const decompressRequestId = `archive-decompress-${crypto.randomUUID()}`;
      const decompressResponsePromise = waitForJson(
        session.socket,
        (message) => message.requestId === decompressRequestId
          && ['sftp:decompress:success', 'sftp:decompress:error', 'sftp:command_not_found'].includes(String(message.type)),
        30_000,
      );
      sendJson(session.socket, {
        type: 'sftp:decompress',
        requestId: decompressRequestId,
        payload: { source: '/archive-source.zip' },
      });
      const decompressResponse = await decompressResponsePromise;
      test.skip(decompressResponse.type === 'sftp:command_not_found', 'unzip is not installed in this test environment');
      expect(decompressResponse.type).toBe('sftp:decompress:success');

      const restored = await requestJson(
        session.socket,
        'sftp:readfile',
        { path: '/archive-source.txt', encoding: 'utf8' },
        'sftp:readfile:success',
        'sftp:readfile:error',
      );
      expect(Buffer.from(String(restored.payload?.rawContentBase64 ?? ''), 'base64').toString('utf8'))
        .toContain('archive-me');
    });
  } finally {
    await closeWebSocket(session.socket);
  }
});

test('ZIP Unicode Path entries extract Chinese filenames instead of #U escapes', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const session = await openSshSession(request, connectionId, `archive-unicode-${crypto.randomUUID()}`);

  try {
    await waitForSftpReady(session.socket);
    const requestId = `archive-unicode-${crypto.randomUUID()}`;
    const responsePromise = waitForJson(
      session.socket,
      (message) => message.requestId === requestId
        && ['sftp:decompress:success', 'sftp:decompress:error', 'sftp:command_not_found'].includes(String(message.type)),
      30_000,
    );
    sendJson(session.socket, {
      type: 'sftp:decompress',
      requestId,
      payload: { source: '/中文解压测试.zip' },
    });
    const response = await responsePromise;
    test.skip(response.type === 'sftp:command_not_found', 'unzip is not installed in this test environment');
    expect(response.type).toBe('sftp:decompress:success');

    const extracted = await requestJson(
      session.socket,
      'sftp:readfile',
      { path: '/中文解压测试', encoding: 'utf8' },
      'sftp:readfile:success',
      'sftp:readfile:error',
    );
    expect(Buffer.from(String(extracted.payload?.rawContentBase64 ?? ''), 'base64').toString('utf8'))
      .toContain('unicode-path-e2e');

    const root = await requestJson(
      session.socket,
      'sftp:readdir',
      { path: '/' },
      'sftp:readdir:success',
      'sftp:readdir:error',
    );
    const filenames = (Array.isArray(root.payload) ? root.payload : []).map((item: { filename?: string }) => item.filename);
    expect(filenames).toContain('中文解压测试');
    expect(filenames).not.toContain('#U4e2d#U6587#U89e3#U538b#U6d4b#U8bd5');
  } finally {
    await closeWebSocket(session.socket);
  }
});

test('password-protected ZIP validates passwords and preserves the normal decompress flow', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const session = await openSshSession(request, connectionId, `archive-password-${crypto.randomUUID()}`);
  const specialPassword = "Nexus !@#$%^&*()_+-=[]{};:'\",.<>/?\\|`~";
  const maxPassword = 'x'.repeat(128);

  const archiveRequest = async (
    type: 'sftp:compress' | 'sftp:decompress',
    payload: Record<string, unknown>,
  ) => {
    const requestId = `archive-password-${crypto.randomUUID()}`;
    const responsePromise = waitForJson(
      session.socket,
      (message) => message.requestId === requestId
        && [`${type}:success`, `${type}:error`, 'sftp:command_not_found'].includes(String(message.type)),
      30_000,
    );
    sendJson(session.socket, { type, requestId, payload });
    return responsePromise;
  };

  try {
    await waitForSftpReady(session.socket);

    await step('create a password-protected ZIP with shell-special characters', async () => {
      const response = await archiveRequest('sftp:compress', {
        sources: ['/archive-source.txt'],
        destination: '/archive-special.zip',
        format: 'zip',
        password: specialPassword,
      });
      test.skip(response.type === 'sftp:command_not_found', 'zip is not installed in this test environment');
      expect(response.type).toBe('sftp:compress:success');

      await requestJson(
        session.socket,
        'sftp:delete_paths',
        { paths: ['/archive-source.txt'] },
        'sftp:delete_paths:success',
        'sftp:delete_paths:error',
      );
    });

    await step('decompress without a password reports PASSWORD_REQUIRED without extracting files', async () => {
      const response = await archiveRequest('sftp:decompress', { source: '/archive-special.zip' });
      test.skip(response.type === 'sftp:command_not_found', 'unzip is not installed in this test environment');
      expect(response.type).toBe('sftp:decompress:error');
      expect(response.payload?.code).toBe('PASSWORD_REQUIRED');

      const root = await requestJson(
        session.socket,
        'sftp:readdir',
        { path: '/' },
        'sftp:readdir:success',
        'sftp:readdir:error',
      );
      expect((Array.isArray(root.payload) ? root.payload : []).map((item: { filename?: string }) => item.filename))
        .not.toContain('archive-source.txt');
    });

    await step('wrong password reports INVALID_PASSWORD and correct special-character password succeeds', async () => {
      const wrongResponse = await archiveRequest('sftp:decompress', {
        source: '/archive-special.zip',
        password: 'definitely-wrong',
      });
      expect(wrongResponse.type).toBe('sftp:decompress:error');
      expect(wrongResponse.payload?.code).toBe('INVALID_PASSWORD');

      const correctResponse = await archiveRequest('sftp:decompress', {
        source: '/archive-special.zip',
        password: specialPassword,
      });
      expect(correctResponse.type).toBe('sftp:decompress:success');

      const restored = await requestJson(
        session.socket,
        'sftp:readfile',
        { path: '/archive-source.txt', encoding: 'utf8' },
        'sftp:readfile:success',
        'sftp:readfile:error',
      );
      expect(Buffer.from(String(restored.payload?.rawContentBase64 ?? ''), 'base64').toString('utf8'))
        .toContain('archive-me');
    });

    await step('128-character password is accepted and round-trips', async () => {
      const compressResponse = await archiveRequest('sftp:compress', {
        sources: ['/archive-source.txt'],
        destination: '/archive-max-password.zip',
        format: 'zip',
        password: maxPassword,
      });
      expect(compressResponse.type).toBe('sftp:compress:success');

      await requestJson(
        session.socket,
        'sftp:delete_paths',
        { paths: ['/archive-source.txt'] },
        'sftp:delete_paths:success',
        'sftp:delete_paths:error',
      );

      const decompressResponse = await archiveRequest('sftp:decompress', {
        source: '/archive-max-password.zip',
        password: maxPassword,
      });
      expect(decompressResponse.type).toBe('sftp:decompress:success');
    });

    await step('129-character and line-break passwords are rejected before shell execution', async () => {
      const tooLong = await archiveRequest('sftp:compress', {
        sources: ['/archive-source.txt'],
        destination: '/archive-too-long.zip',
        format: 'zip',
        password: 'x'.repeat(129),
      });
      expect(tooLong.type).toBe('sftp:compress:error');
      expect(tooLong.payload?.code).toBe('PASSWORD_TOO_LONG');

      const invalidFormat = await archiveRequest('sftp:compress', {
        sources: ['/archive-source.txt'],
        destination: '/archive-invalid-password.zip',
        format: 'zip',
        password: 'line-one\nline-two',
      });
      expect(invalidFormat.type).toBe('sftp:compress:error');
      expect(invalidFormat.payload?.code).toBe('INVALID_PASSWORD_FORMAT');

      const nullCharacter = await archiveRequest('sftp:compress', {
        sources: ['/archive-source.txt'],
        destination: '/archive-null-password.zip',
        format: 'zip',
        password: 'before\0after',
      });
      expect(nullCharacter.type).toBe('sftp:compress:error');
      expect(nullCharacter.payload?.code).toBe('INVALID_PASSWORD_FORMAT');
    });
  } finally {
    await closeWebSocket(session.socket);
  }
});
