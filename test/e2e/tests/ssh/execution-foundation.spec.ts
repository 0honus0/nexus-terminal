import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '../../support/fixtures';
import { E2E_SSH } from '../../support/ssh';
import { executeSshCommand } from '../../../../packages/backend/src/execution/ssh-command-executor';
import { CommandSessionManager } from '../../../../packages/backend/src/execution/command-session-manager';
import type { CommandSession } from '../../../../packages/backend/src/execution/command-session';
import { ExecutionSessionManager } from '../../../../packages/backend/src/execution/execution-session-manager';
import { SshConnectionFactory } from '../../../../packages/backend/src/transport/ssh/ssh-connection-factory';

const backendRequire = createRequire(path.resolve(process.cwd(), '../../packages/backend/package.json'));
const { Client } = backendRequire('ssh2') as { Client: new () => any };

async function connectRawSshClient(): Promise<any> {
  const client = new Client();
  await new Promise<void>((resolve, reject) => {
    client.once('ready', resolve);
    client.once('error', reject);
    client.connect({
      host: E2E_SSH.host,
      port: E2E_SSH.port,
      username: E2E_SSH.username,
      password: E2E_SSH.password,
      readyTimeout: 5_000,
    });
  });
  return client;
}

async function waitForCommandSessionClose(session: CommandSession): Promise<void> {
  if (!session.isRunning) return;
  await new Promise<void>((resolve) => session.once('close', () => resolve()));
}

test('bounded SSH commands abort without closing the shared transport', async () => {
  const client = await connectRawSshClient();
  try {
    const before = await executeSshCommand(client, { command: "printf 'EXEC_BEFORE\\n'" });
    expect(before.stdout).toContain('EXEC_BEFORE');

    const controller = new AbortController();
    const aborted = executeSshCommand(client, {
      command: "sleep 10; printf 'SHOULD_NOT_PRINT\\n'",
      timeoutMs: 15_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });

    const after = await executeSshCommand(client, { command: "printf 'EXEC_AFTER\\n'" });
    expect(after.stdout).toContain('EXEC_AFTER');
  } finally {
    client.end();
  }
});

test('command sessions buffer early output and terminate without closing the shared transport', async () => {
  const client = await connectRawSshClient();
  const manager = new CommandSessionManager(client);
  try {
    const fast = await manager.start({ command: "printf 'EARLY_OUTPUT\\n'" });
    await waitForCommandSessionClose(fast);
    expect(fast.snapshot()).toMatchObject({
      status: 'completed',
      stdout: expect.stringContaining('EARLY_OUTPUT'),
      outputTruncated: false,
    });

    const longRunning = await manager.start({
      id: `e2e-long-${crypto.randomUUID()}`,
      command: "printf 'LONG_STARTED\\n'; sleep 10; printf 'LONG_FINISHED\\n'",
      execOptions: { pty: true },
      maxOutputBytes: 64 * 1024,
    });
    await expect.poll(() => longRunning.stdout, { timeout: 3_000 }).toContain('LONG_STARTED');
    await longRunning.terminate({ signal: 'TERM', graceMs: 100, forceMs: 500 });
    expect(longRunning.isRunning).toBeFalsy();
    expect(longRunning.stdout).toContain('LONG_STARTED');
    expect(longRunning.stdout).not.toContain('LONG_FINISHED');

    const after = await executeSshCommand(client, { command: "printf 'SESSION_AFTER\\n'" });
    expect(after.stdout).toContain('SESSION_AFTER');
  } finally {
    await manager.closeAll();
    client.end();
  }
});

test('execution session manager owns SSH and SFTP lifecycle from connection creation through close', async () => {
  const manager = new ExecutionSessionManager();
  const session = await manager.connect({
    id: `e2e-execution-${crypto.randomUUID()}`,
    ownerType: 'system',
    ownerId: 'e2e',
    connection: {
      id: -1,
      name: 'E2E execution foundation',
      host: E2E_SSH.host,
      port: E2E_SSH.port,
      username: E2E_SSH.username,
      authMethod: 'password',
      password: E2E_SSH.password,
      route: null,
      proxy: null,
    },
  });

  expect(session.isReady).toBeTruthy();
  expect(manager.require(session.id)).toBe(session);

  const command = await executeSshCommand(session.client, { command: "printf 'MANAGED_EXEC\\n'" });
  expect(command.stdout).toContain('MANAGED_EXEC');

  const sftp = await session.sftp.ensure('control');
  const entries = await new Promise<string[]>((resolve, reject) => {
    sftp.readdir('/', (error, list) => {
      if (error) reject(error);
      else resolve(list.map((entry) => entry.filename));
    });
  });
  expect(entries.length).toBeGreaterThan(0);

  manager.delete(session.id);
  expect(manager.get(session.id)).toBeUndefined();
  expect(session.status).toBe('closed');
  expect(() => session.client).toThrow(/not attached/);
});

test('SSH connection factory reaches the target through an HTTP CONNECT proxy', async () => {
  const factory = new SshConnectionFactory();
  const proxyPort = Number(new URL(E2E_SSH.controlUrl).port);
  const client = await factory.connect({
    id: -1,
    name: 'E2E proxied SSH',
    host: E2E_SSH.host,
    port: E2E_SSH.port,
    username: E2E_SSH.username,
    authMethod: 'password',
    password: E2E_SSH.password,
    route: 'proxy',
    proxy: {
      id: -1,
      name: 'E2E HTTP CONNECT proxy',
      type: 'HTTP',
      host: E2E_SSH.host,
      port: proxyPort,
    },
  });
  try {
    const result = await executeSshCommand(client, { command: "printf 'PROXY_ROUTE_OK\\n'" });
    expect(result.stdout).toContain('PROXY_ROUTE_OK');
  } finally {
    client.end();
  }
});

test('SSH connection factory reaches the target through a jump host and releases intermediates', async () => {
  const factory = new SshConnectionFactory();
  const client = await factory.connect({
    id: -1,
    name: 'E2E jump target',
    host: E2E_SSH.host,
    port: E2E_SSH.port,
    username: E2E_SSH.username,
    authMethod: 'password',
    password: E2E_SSH.password,
    route: 'jump',
    jumpChain: [{
      id: 'e2e-hop-1',
      name: 'E2E jump host',
      host: E2E_SSH.host,
      port: E2E_SSH.port,
      username: E2E_SSH.username,
      authMethod: 'password',
      password: E2E_SSH.password,
    }],
  });
  const result = await executeSshCommand(client, { command: "printf 'JUMP_ROUTE_OK\\n'" });
  expect(result.stdout).toContain('JUMP_ROUTE_OK');
  client.end();

  await expect.poll(async () => {
    const response = await fetch(`${E2E_SSH.controlUrl}/ssh/status`);
    const body = await response.json() as { activeClients: number };
    return body.activeClients;
  }, { timeout: 3_000 }).toBe(0);
});
