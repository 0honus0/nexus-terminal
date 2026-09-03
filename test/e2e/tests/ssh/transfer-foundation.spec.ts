import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { TransferTaskRegistry } from '../../../../packages/backend/src/modules/transfers/transfer-task-registry';
import { TransferOrchestrator } from '../../../../packages/backend/src/modules/transfers/transfer-orchestrator';
import { RsyncTransferStrategy } from '../../../../packages/backend/src/platform/operations/transfer/strategies/rsync-transfer.strategy';
import { ScpTransferStrategy } from '../../../../packages/backend/src/platform/operations/transfer/strategies/scp-transfer.strategy';

const transferPayload = {
  sourceConnectionId: 1,
  connectionIds: [2, 3],
  sourceItems: [
    { name: 'one.txt', path: '/data/one.txt', type: 'file' as const },
    { name: 'folder', path: '/data/folder', type: 'directory' as const },
  ],
  remoteTargetPath: '/srv/target',
  transferMethod: 'auto' as const,
};

test('transfer task registry owns task lifecycle, user isolation and cancellation', async () => {
  const registry = new TransferTaskRegistry();
  const { task, abortController } = registry.create(transferPayload, 42);

  expect(task.subTasks).toHaveLength(4);
  expect(registry.details(task.taskId, 7)).toBeNull();
  expect(registry.remove(task.taskId, 42)).toBe('active');
  expect(abortController.signal.aborted).toBe(false);

  expect(registry.cancel(task.taskId, 42)).toBe(true);
  expect(abortController.signal.aborted).toBe(true);
  const cancelled = registry.details(task.taskId, 42);
  expect(cancelled?.status).toBe('cancelled');
  expect(cancelled?.subTasks.every((subTask) => subTask.status === 'cancelled')).toBe(true);

  registry.releaseAbortController(task.taskId);
  expect(registry.remove(task.taskId, 42)).toBe('removed');
  expect(registry.details(task.taskId, 42)).toBeNull();
});

test('rsync and scp strategies build isolated commands and parse progress', async () => {
  const rsync = new RsyncTransferStrategy();
  const scp = new ScpTransferStrategy();

  const rsyncCommand = rsync.build({
    sourcePath: '/data/folder with space',
    isDirectory: true,
    targetPath: '/srv/target',
    executable: '/usr/bin/rsync',
    targetUserAndHost: 'deploy@example.test',
    targetPort: 2222,
    identityFile: '/tmp/nexus key',
  });
  expect(rsyncCommand).toContain("'/usr/bin/rsync' -avz --progress");
  expect(rsyncCommand).toContain('-e "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 2222 -i \'/tmp/nexus key\'"');
  expect(rsyncCommand).toContain("'/data/folder with space/'");
  expect(rsyncCommand).toContain("'deploy@example.test:/srv/target/'");
  expect(rsync.parseProgress('  1,234  67%   1.00MB/s')).toBe(67);

  const scpCommand = scp.build({
    sourcePath: '/data/one.txt',
    isDirectory: false,
    targetPath: '/srv/target',
    executable: '/usr/bin/scp',
    targetUserAndHost: 'deploy@example.test',
    targetPort: 2200,
    sshPassCommand: "'/usr/bin/sshpass' -p 'secret'",
  });
  expect(scpCommand).toContain("'/usr/bin/sshpass' -p 'secret' '/usr/bin/scp'");
  expect(scpCommand).toContain('-P 2200');
  expect(scpCommand).toContain("'/data/one.txt' 'deploy@example.test:/srv/target/'");
  expect(scp.parseProgress('anything')).toBe(50);
  expect(scp.execOptions({
    sourcePath: '/data/one.txt',
    isDirectory: false,
    targetPath: '/srv/target',
    executable: '/usr/bin/scp',
    targetUserAndHost: 'deploy@example.test',
    targetPort: 22,
    sshPassCommand: 'sshpass',
  })).toEqual({ pty: true });
});

test('transfer orchestrator limits concurrency and maps executor progress into task state', async () => {
  const registry = new TransferTaskRegistry();
  const { task, abortController } = registry.create(transferPayload, 42);
  let activeExecutions = 0;
  let maxActiveExecutions = 0;
  let sourceEndCalls = 0;

  const executor = {
    execute: async ({ onProgress }: any) => {
      activeExecutions += 1;
      maxActiveExecutions = Math.max(maxActiveExecutions, activeExecutions);
      onProgress?.({ method: 'scp', progress: 35, message: 'fake transfer running' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      activeExecutions -= 1;
      return 'scp' as const;
    },
  };
  const connection = {
    id: 1,
    name: 'fake',
    host: '127.0.0.1',
    port: 22,
    username: 'tester',
    authMethod: 'password' as const,
    route: null,
    proxy: null,
  };
  const orchestrator = new TransferOrchestrator(registry, executor, {
    maxConcurrentSubTasks: 2,
    resolveConnection: async (connectionId) => ({ ...connection, id: connectionId }),
    connectSource: async () => ({ end: () => { sourceEndCalls += 1; } } as any),
  });

  await orchestrator.process(task.taskId, abortController.signal);

  const completed = registry.details(task.taskId, 42);
  expect(completed?.status).toBe('completed');
  expect(completed?.overallProgress).toBe(100);
  expect(completed?.subTasks.every((subTask) => subTask.status === 'completed')).toBe(true);
  expect(completed?.subTasks.every((subTask) => subTask.transferMethodUsed === 'scp')).toBe(true);
  expect(maxActiveExecutions).toBe(2);
  expect(sourceEndCalls).toBe(1);
  expect(registry.remove(task.taskId, 42)).toBe('removed');
});

test('transfer HTTP facade keeps task API stable and preserves fatal failures', async ({ request }) => {
  await loginAsInitialAdmin(request);
  const createResponse = await request.post('/api/v1/transfers/send', {
    data: {
      sourceConnectionId: 2_147_483_647,
      connectionIds: [1],
      sourceItems: [{ name: 'missing.txt', path: '/missing.txt', type: 'file' }],
      remoteTargetPath: '/tmp/nexus-transfer-target',
      transferMethod: 'scp',
    },
  });
  expect(createResponse.status()).toBe(202);
  const created = await createResponse.json() as { taskId: string; status: string };
  expect(created.taskId).toBeTruthy();

  await expect.poll(async () => {
    const response = await request.get(`/api/v1/transfers/status/${created.taskId}`);
    expect(response.status()).toBe(200);
    return (await response.json() as { status: string }).status;
  }, { timeout: 10_000 }).toBe('failed');

  const detailResponse = await request.get(`/api/v1/transfers/status/${created.taskId}`);
  const detail = await detailResponse.json() as { status: string; subTasks: Array<{ status: string }> };
  expect(detail.status).toBe('failed');
  expect(detail.subTasks).toEqual([expect.objectContaining({ status: 'failed' })]);

  const removeResponse = await request.delete(`/api/v1/transfers/${created.taskId}`);
  expect(removeResponse.status()).toBe(204);
});
