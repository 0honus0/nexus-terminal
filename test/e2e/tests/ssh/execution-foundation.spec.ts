import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '../../support/fixtures';
import { E2E_SSH } from '../../support/ssh';
import { executeSshCommand } from '../../../../packages/backend/src/execution/ssh-command-executor';
import { CommandSessionManager } from '../../../../packages/backend/src/execution/command-session-manager';
import type { CommandSession } from '../../../../packages/backend/src/execution/command-session';

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
