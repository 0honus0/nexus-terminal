import { expect, test } from '../../support/fixtures';
import { E2E_SSH } from '../../support/ssh';
import { SshTransportAdapter } from '../../../../packages/backend/src/infrastructure/ssh/ssh-transport.adapter';
import { ExecutionSessionManager } from '../../../../packages/backend/src/platform/execution/execution-session-manager';

const baseConnection = () => ({
  connectionId: -1,
  displayName: 'E2E execution foundation',
  host: E2E_SSH.host,
  port: E2E_SSH.port,
  username: E2E_SSH.username,
  authMethod: 'password' as const,
  password: E2E_SSH.password,
  route: null as null | 'proxy' | 'jump',
});

async function waitForCommandClose(session: { isRunning: boolean }): Promise<void> {
  await expect.poll(() => session.isRunning, { timeout: 3_000 }).toBeFalsy();
}

test('bounded remote commands abort without closing the shared execution transport', async () => {
  const transport = await new SshTransportAdapter().connect(baseConnection());
  try {
    const before = await transport.execute({ command: "printf 'EXEC_BEFORE\\n'" });
    expect(before.stdout).toContain('EXEC_BEFORE');

    const controller = new AbortController();
    const aborted = transport.execute({
      command: "sleep 10; printf 'SHOULD_NOT_PRINT\\n'",
      timeoutMs: 15_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });

    const after = await transport.execute({ command: "printf 'EXEC_AFTER\\n'" });
    expect(after.stdout).toContain('EXEC_AFTER');
  } finally {
    await transport.close();
  }
});

test('remote command sessions buffer early output and terminate without closing their transport', async () => {
  const transport = await new SshTransportAdapter().connect(baseConnection());
  try {
    const fast = await transport.startCommand({ command: "printf 'EARLY_OUTPUT\\n'" });
    await waitForCommandClose(fast);
    expect(fast.snapshot()).toMatchObject({
      status: 'completed',
      stdout: expect.stringContaining('EARLY_OUTPUT'),
      outputTruncated: false,
    });

    const longRunning = await transport.startCommand({
      command: "printf 'LONG_STARTED\\n'; sleep 10; printf 'LONG_FINISHED\\n'",
      pty: true,
      maxOutputBytes: 64 * 1024,
    });
    await expect.poll(() => longRunning.snapshot().stdout, { timeout: 3_000 }).toContain('LONG_STARTED');
    await longRunning.terminate({ signal: 'TERM', graceMs: 100, forceMs: 500 });
    expect(longRunning.isRunning).toBeFalsy();
    expect(longRunning.snapshot().stdout).toContain('LONG_STARTED');
    expect(longRunning.snapshot().stdout).not.toContain('LONG_FINISHED');

    const after = await transport.execute({ command: "printf 'SESSION_AFTER\\n'" });
    expect(after.stdout).toContain('SESSION_AFTER');
  } finally {
    await transport.close();
  }
});

test('execution session manager owns transport lifecycle and supports abstract detach/attach', async () => {
  const manager = new ExecutionSessionManager(new SshTransportAdapter());
  const session = await manager.connect({
    id: `e2e-execution-${crypto.randomUUID()}`,
    ownerType: 'system',
    ownerId: 'e2e',
    connection: baseConnection(),
  });

  expect(session.isReady).toBeTruthy();
  expect(manager.require(session.id)).toBe(session);
  expect((await session.execute({ command: "printf 'MANAGED_EXEC\\n'" })).stdout).toContain('MANAGED_EXEC');

  const detached = manager.detach(session.id);
  expect(session.status).toBe('detached');
  expect(manager.get(session.id)).toBeUndefined();

  const resumed = manager.attach({
    connectionId: -1,
    ownerType: 'system',
    ownerId: 'e2e-resumed',
    transport: detached,
  });
  expect((await resumed.execute({ command: "printf 'RESUMED_EXEC\\n'" })).stdout).toContain('RESUMED_EXEC');

  await manager.close(resumed.id);
  expect(resumed.status).toBe('closed');
  await expect(resumed.execute({ command: 'true' })).rejects.toThrow(/not attached/);
});

test('SSH transport reaches the target through an HTTP CONNECT proxy', async () => {
  const proxyPort = Number(new URL(E2E_SSH.controlUrl).port);
  const transport = await new SshTransportAdapter().connect({
    ...baseConnection(),
    displayName: 'E2E proxied SSH',
    route: 'proxy',
    proxy: {
      type: 'HTTP',
      host: E2E_SSH.host,
      port: proxyPort,
    },
  });
  try {
    expect((await transport.execute({ command: "printf 'PROXY_ROUTE_OK\\n'" })).stdout).toContain('PROXY_ROUTE_OK');
  } finally {
    await transport.close();
  }
});

test('SSH transport reaches the target through a jump host and releases intermediates', async () => {
  const transport = await new SshTransportAdapter().connect({
    ...baseConnection(),
    displayName: 'E2E jump target',
    route: 'jump',
    jumpChain: [{
      host: E2E_SSH.host,
      port: E2E_SSH.port,
      username: E2E_SSH.username,
      authMethod: 'password',
      password: E2E_SSH.password,
    }],
  });

  expect((await transport.execute({ command: "printf 'JUMP_ROUTE_OK\\n'" })).stdout).toContain('JUMP_ROUTE_OK');
  await transport.close();

  await expect.poll(async () => {
    const response = await fetch(`${E2E_SSH.controlUrl}/ssh/status`);
    const body = await response.json() as { activeClients: number };
    return body.activeClients;
  }, { timeout: 3_000 }).toBe(0);
});
