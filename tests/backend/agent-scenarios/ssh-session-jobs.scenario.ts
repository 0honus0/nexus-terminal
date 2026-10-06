import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from '../../../packages/backend/node_modules/ssh2';
import { DatabaseAdapter } from '../../../packages/backend/src/infrastructure/database/database.adapter';
import { AgentSshSessions } from '../../../packages/backend/src/infrastructure/agent/capabilities/agent-ssh-sessions';
import { SshTransportAdapter } from '../../../packages/backend/src/infrastructure/ssh/ssh-transport.adapter';
import { ExecutionSessionManager } from '../../../packages/backend/src/platform/execution/execution-session-manager';
import type { ToolContext } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { createSshSessionTools } from '../../../packages/backend/src/modules/agent/tools/host/ssh-session-tools';
import { withSshSessionInput } from '../../../packages/backend/src/modules/agent/tools/host/ssh-session-input';
import { ToolExecutor } from '../../../packages/backend/src/modules/agent/capabilities/tool-executor';
import { ToolCatalog } from '../../../packages/backend/src/modules/agent/capabilities/tool-catalog';
import { CapabilityRegistry } from '../../../packages/backend/src/modules/agent/host/capability-registry';
import type { AppCapabilityBroker } from '../../../packages/backend/src/modules/agent/host/app-capability-broker';

export const sshSessionJobsScenario = async () => {
  const directory = mkdtempSync(join(existsSync('/tmp/opencode') ? '/tmp/opencode' : tmpdir(), 'nexus-ssh-scenario-'));
  const db = new DatabaseAdapter({ dataDirectory: directory, filename: 'ssh.sqlite', nodeEnv: 'test' });
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  let authentications = 0;
  const pending = new Map<string, () => void>();
  let readStarted!: () => void;
  let readClosed!: () => void;
  const readBarrier = new Promise<void>((resolve) => {
    readStarted = resolve;
  });
  const readTeardown = new Promise<void>((resolve) => {
    readClosed = resolve;
  });
  let sftpChannels = 0;
  const server = new Server({ hostKeys: [key] }, (client) => {
    client.on('authentication', (auth) => {
      authentications++;
      auth.accept();
    });
    client.on('ready', () =>
      client.on('session', (accept) => {
        const session = accept();
        session.on('sftp', (acceptSftp) => {
          sftpChannels++;
          const sftp = acceptSftp();
          sftp.on('end', () => sftp.end());
          sftp.on('OPEN', (id) => sftp.handle(id, Buffer.from('fixture')));
          sftp.on('READ', () => readStarted());
          sftp.on('close', readClosed);
        });
        session.on('exec', (acceptCommand, _reject, info) => {
          const channel = acceptCommand();
          const complete = () => {
            channel.write(info.command);
            channel.exit(0);
            channel.end();
          };
          if (info.command.startsWith('hold')) pending.set(info.command, complete);
          else complete();
          channel.on('signal', (_accept, _rejectSignal, signal) => {
            if (signal.name === 'TERM') {
              channel.exit(info.command === 'hold-timeout' ? 0 : 143);
              channel.end();
            }
          });
        });
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  let hash = 'config-one';
  let authorized = true;
  const connection = {
    connectionId: 1,
    displayName: 'fixture',
    host: '127.0.0.1',
    port: address.port,
    username: 'fixture',
    password: 'fixture',
    authMethod: 'password' as const,
    route: null,
  };
  const resolver = {
    list: async () => [],
    get: async () => ({
      id: 1,
      name: 'fixture',
      type: 'SSH',
      host: connection.host,
      port: address.port,
      username: 'fixture',
      updatedAt: 1,
      configurationHash: hash,
    }),
    resolve: async () => connection,
  };
  const manager = new ExecutionSessionManager(new SshTransportAdapter());
  const sessions = new AgentSshSessions(resolver, manager, db, async () => authorized);
  const context: ToolContext = {
    userId: 1,
    appId: 'fixture',
    threadId: 'thread-one',
    runId: 'run-one',
    agentRuntimeId: 'root-one',
    actor: { kind: 'user', userId: 1 },
    connectionIds: [1],
    environment: null,
    stepId: 'step',
    signal: new AbortController().signal,
    deadlineAt: Math.floor(Date.now() / 1000) + 60,
    maxOutputBytes: 4096,
    inputRevision: 1,
  };
  try {
    await sessions.initialize();
    const cryptoHash = { sha256Utf8: (text: string) => createHash('sha256').update(text).digest('hex') };
    const tools = createSshSessionTools(
      sessions,
      {
        target: async () => ({
          kind: 'ssh',
          target: 'ssh',
          id: '1',
          connectionId: 1,
          targetIdentity: 'ssh:1',
          endpoint: 'fixture',
          loginUser: 'fixture',
          configurationHash: hash,
          hostKeyTrust: 'unavailable',
        }),
      },
      cryptoHash,
    );
    const listTool = tools.find((t) => t.descriptor.name === 'ssh_session_list')!;
    const closeTool = tools.find((t) => t.descriptor.name === 'ssh_session_close')!;
    const catalog = new ToolCatalog();
    catalog.registerContribution({ schemaVersion: 1, id: 'ssh-session-regression', tools });
    const capabilities = new CapabilityRegistry();
    const broker: Pick<AppCapabilityBroker, 'authorize'> = {
      authorize: async (_scope, capability, resource) =>
        capabilities.allows(
          capability!,
          { kind: 'targets', targets: { ssh: { mode: 'ids', ids: ['1'] } } },
          resource?.target,
        )
          ? { allowed: true, policyRevision: 1 }
          : { allowed: false, code: 'APP_CAPABILITY_DENIED', policyRevision: 1 },
    };
    const executor = new ToolExecutor(catalog, broker as AppCapabilityBroker);
    await assert.rejects(
      () =>
        executor.inspect(context, {
          providerCallId: 'denied-session',
          name: 'ssh_session_open',
          argumentsJson: '{"connectionId":2}',
        }),
      /APP_CAPABILITY_DENIED/,
    );
    const opening = await executor.inspect(context, {
      providerCallId: 'allowed-session',
      name: 'ssh_session_open',
      argumentsJson: '{"connectionId":1}',
    });
    assert.equal(opening.risk, 'control');
    assert.equal(opening.mutation, false);
    const opened = await executor.execute(context, opening);
    const data = opened.data as { session: { sessionId: string } };
    const listing = await listTool.inspect({ connectionId: 1, sessionId: data.session.sessionId }, context, 1);
    assert.equal((await listTool.execute(listing, context)).ok, true);
    const ordinary = await closeTool.inspect({ connectionId: 1, sessionId: data.session.sessionId }, context, 1);
    const force = await closeTool.inspect(
      { connectionId: 1, sessionId: data.session.sessionId, force: true },
      context,
      1,
    );
    assert.equal(closeTool.descriptor.riskClass, 'mutate');
    assert.equal(ordinary.mutation, true);
    assert.equal(force.risk, 'destructive');
    assert.notEqual(ordinary.operationHash, force.operationHash);
    assert.equal((await closeTool.execute(ordinary, context)).ok, true);
    const wrapped = withSshSessionInput(listTool, cryptoHash);
    await assert.rejects(
      () => wrapped.inspect({ target: 'workspace', connectionId: 1, sessionId: 'invalid' }, context, 1),
      /SSH_SESSION_TARGET_MISMATCH/,
    );
    const baselineAuthentications = authentications;
    await sessions.withSession(context, 1, hash, (s) => s.execute({ command: 'short-one' }));
    await sessions.withSession(context, 1, hash, (s) => s.execute({ command: 'short-two' }));
    assert.equal(authentications - baselineAuthentications, 2);
    const persistent = await sessions.open(context, 1, hash, 0);
    const scoped = { ...context, sshSessionId: persistent.sessionId };
    const job = await sessions.startJob(scoped, 1, hash, persistent.sessionId, 'hold-one', 600, 'operation-one');
    const abortRead = new AbortController();
    const blockedRead = sessions.withFileSystem(
      { ...scoped, signal: abortRead.signal },
      1,
      hash,
      async (filesystem) => {
        const reader = await filesystem.openPositionedReader('/fixture.txt');
        try {
          return await reader.read(0, 16);
        } finally {
          await reader.close();
        }
      },
    );
    const readRejected = assert.rejects(blockedRead, /SFTP_CHANNEL_CLOSED/);
    await readBarrier;
    abortRead.abort();
    await readRejected;
    await readTeardown;
    assert.equal(sftpChannels, 1);
    assert.equal((await sessions.list(scoped, 1, persistent.sessionId))[0].status, 'ready');
    assert.equal(
      (await sessions.list(scoped, 1, persistent.sessionId))[0].activeOperations,
      1,
      'only the parallel Job remains active',
    );
    assert.deepEqual(
      (await sessions.listJobs(scoped, 1)).map((job) => job.jobId),
      [job.jobId],
    );
    assert.deepEqual(await sessions.listJobs({ ...scoped, appId: 'other-app' }, 1), []);
    assert.deepEqual(await sessions.listJobs({ ...scoped, threadId: 'other-thread' }, 1), []);
    assert.equal(job.status, 'running');
    const other = await sessions.withSession(
      { ...scoped, runId: 'run-two', agentRuntimeId: 'child-two' },
      1,
      hash,
      (s) => s.execute({ command: 'independent-command' }),
    );
    assert.equal(other.stdout, 'independent-command');
    assert.equal(
      authentications - baselineAuthentications,
      3,
      'background and subsequent command must reuse one SSH authentication',
    );
    await assert.rejects(() => sessions.close(scoped, 1, persistent.sessionId, false), /SSH_SESSION_BUSY/);
    await assert.rejects(
      () => sessions.list({ ...scoped, userId: 2 }, 1, persistent.sessionId),
      /SSH_SESSION_NOT_FOUND/,
    );
    await assert.rejects(
      () => sessions.list({ ...scoped, threadId: 'other-thread' }, 1, persistent.sessionId),
      /SSH_SESSION_NOT_FOUND/,
    );
    pending.get('hold-one')!();
    const completed = await sessions.job(scoped, 1, job.jobId, 'wait', 5);
    assert.deepEqual(await sessions.listJobs(scoped, 1), []);
    assert.equal(completed.status, 'succeeded');
    assert.equal(completed.result.stdout, 'hold-one');
    await assert.rejects(() => sessions.job({ ...scoped, appId: 'other-app' }, 1, job.jobId, 'status'), /NOT_FOUND/);
    await assert.rejects(() =>
      sessions.startJob(scoped, 1, hash, persistent.sessionId, 'must-not-replay', 600, 'operation-one'),
    );
    const expiring = await sessions.open(context, 1, hash, 1);
    await new Promise((resolve) => setTimeout(resolve, 1050));
    await sessions.sweep();
    await assert.rejects(() => sessions.list(context, 1, expiring.sessionId), /SSH_SESSION_NOT_FOUND/);
    const cancelled = await sessions.startJob(
      scoped,
      1,
      hash,
      persistent.sessionId,
      'hold-cancel',
      600,
      'operation-cancel',
    );
    const cancellation = await sessions.job(scoped, 1, cancelled.jobId, 'cancel');
    assert.notEqual(cancellation.status, 'running');
    assert.equal(
      (await sessions.withSession(scoped, 1, hash, (s) => s.execute({ command: 'after-cancel' }))).exitCode,
      0,
    );
    const waiting = await sessions.startJob(
      scoped,
      1,
      hash,
      persistent.sessionId,
      'hold-wait-abort',
      600,
      'operation-wait-abort',
    );
    const controller = new AbortController();
    const wait = sessions.job({ ...scoped, signal: controller.signal }, 1, waiting.jobId, 'wait', 30);
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(() => wait, /Aborted/);
    assert.equal(
      (await sessions.job(scoped, 1, waiting.jobId, 'status')).status,
      'running',
      'aborting a wait must not cancel the background command',
    );
    pending.get('hold-wait-abort')!();
    await sessions.job(scoped, 1, waiting.jobId, 'wait', 5);
    const bounded = await sessions.startJob(
      scoped,
      1,
      hash,
      persistent.sessionId,
      'hold-timeout',
      1,
      'operation-timeout',
    );
    const timedOut = await sessions.job(scoped, 1, bounded.jobId, 'wait', 8);
    assert.notEqual(timedOut.status, 'running');
    assert.equal(timedOut.result.timedOut, true);
    assert.notEqual(
      timedOut.status,
      'succeeded',
      'a zero exit code after timeout is not successful execution evidence',
    );
    const forced = await sessions.startJob(scoped, 1, hash, persistent.sessionId, 'hold-force', 600, 'operation-force');
    await sessions.close(scoped, 1, persistent.sessionId, true);
    assert.equal((await sessions.job(scoped, 1, forced.jobId, 'status')).status, 'unknown');
    await assert.rejects(
      () => sessions.withSession(scoped, 1, hash, (s) => s.execute({ command: 'never-replayed' })),
      /SSH_SESSION_NOT_FOUND/,
    );
    const stale = await sessions.open(context, 1, hash, 0);
    hash = 'config-two';
    await sessions.sweep();
    await assert.rejects(() => sessions.list(context, 1, stale.sessionId), /SSH_SESSION_NOT_FOUND/);
    const revoked = await sessions.open(context, 1, hash, 0);
    authorized = false;
    await sessions.sweep();
    authorized = true;
    await assert.rejects(() => sessions.list(context, 1, revoked.sessionId), /SSH_SESSION_NOT_FOUND/);
    const scopedCleanup = await sessions.open(context, 1, hash, 0);
    await sessions.closeScope(context, context.threadId);
    await assert.rejects(() => sessions.list(context, 1, scopedCleanup.sessionId), /SSH_SESSION_NOT_FOUND/);
    await db.execute(
      "INSERT INTO agent_ssh_jobs (job_id,user_id,app_id,thread_id,connection_id,configuration_hash,session_id,operation_hash,status,result_json,created_at) VALUES ('restart-job',1,'fixture','thread-one',1,?,'lost-session','restart-operation','running',?,?)",
      [hash, JSON.stringify(job.result), Date.now()],
    );
    await sessions.initialize();
    assert.equal((await sessions.job(context, 1, 'restart-job', 'status')).status, 'unknown');
    return [{ name: 'ssh_persistent_background_isolation', value: 1, unit: 'scenarios' }];
  } finally {
    await sessions.dispose();
    await manager.closeAll();
    await db.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
};
