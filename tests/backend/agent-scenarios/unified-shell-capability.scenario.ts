import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { JsonValue, Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import { SshShellTargetAdapter } from '../../../packages/backend/src/infrastructure/agent/capabilities/ssh-shell-target.adapter';
import type { AgentSshSessions } from '../../../packages/backend/src/infrastructure/agent/capabilities/agent-ssh-sessions';
import type { AgentConnectionResolverPort } from '../../../packages/backend/src/modules/agent/capabilities/ssh-target-resolver.port';
import type {
  AgentSshSessionPort,
  SshJobView,
} from '../../../packages/backend/src/modules/agent/capabilities/ssh-session.port';
import { CommandExecutionError } from '../../../packages/backend/src/platform/execution/remote-execution.port';
import type { ExecutionSession } from '../../../packages/backend/src/platform/execution/execution-session';
import { ShellCapabilityService } from '../../../packages/backend/src/modules/agent/capabilities/shell-capability.service';
import type { SshTargetResolverPort } from '../../../packages/backend/src/modules/agent/capabilities/ssh-target-resolver.port';
import { ToolCatalog } from '../../../packages/backend/src/modules/agent/capabilities/tool-catalog';
import { ToolExecutor } from '../../../packages/backend/src/modules/agent/capabilities/tool-executor';
import type { ToolContext } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { AppCapabilityBroker } from '../../../packages/backend/src/modules/agent/host/app-capability-broker';
import { CapabilityRegistry } from '../../../packages/backend/src/modules/agent/host/capability-registry';
import { createUnifiedShellTools } from '../../../packages/backend/src/modules/agent/tools/host/shell-tools';

export const unifiedShellCapabilityScenario = async () => {
  const sshHashes = new Map<number, string>([
    [1, 'ssh-config-one'],
    [2, 'ssh-config-two'],
  ]);
  const calls: Array<{ connectionId: number; hash: string; command: string }> = [];
  let sshExitCode = 0;
  let sshSignal: string | undefined;
  const cryptoHash = { sha256Utf8: (value: string) => createHash('sha256').update(value, 'utf8').digest('hex') };
  const targets: SshTargetResolverPort = {
    target: async (context, connectionId) => {
      if (!context.connectionIds.includes(connectionId)) throw new Error('TARGET_NOT_SELECTED');
      const configurationHash = sshHashes.get(connectionId);
      if (!configurationHash) throw new Error('NOT_FOUND');
      return {
        kind: 'ssh',
        target: 'ssh',
        id: String(connectionId),
        connectionId,
        targetIdentity: `ssh:${connectionId}`,
        endpoint: `ssh-${connectionId}.example:22`,
        loginUser: `user-${connectionId}`,
        configurationHash,
        hostKeyTrust: 'unavailable',
      };
    },
  };
  const shellPort = new SshShellTargetAdapter(
    {
      get: async (connectionId: number) => ({ type: 'SSH', configurationHash: sshHashes.get(connectionId) }),
    } as unknown as AgentConnectionResolverPort,
    {
      withSession: async (
        _context: ToolContext,
        connectionId: number,
        expectedConfigurationHash: string,
        work: (session: ExecutionSession) => Promise<unknown>,
      ) => {
        if (sshHashes.get(connectionId) !== expectedConfigurationHash) throw new Error('RESOURCE_CHANGED');
        return work({
          execute: async ({ command }: { command: string }) => {
            calls.push({ connectionId, hash: expectedConfigurationHash, command });
            const result = {
              exitCode: sshExitCode,
              signal: sshSignal,
              stdout: `ssh-${connectionId}-ok\n`,
              stderr: sshExitCode ? 'EXPECTED_FAILURE\n' : '',
              truncated: false,
            };
            if (sshExitCode !== 0 || sshSignal) throw new CommandExecutionError('SSH execution failed', result);
            return result;
          },
        } as unknown as ExecutionSession);
      },
    } as unknown as AgentSshSessions,
  );

  const jobId = 'ssh-job-11111111-2222-3333-4444-555555555555';
  const sessionId = 'existing-ssh-session';
  let job: SshJobView | undefined;
  const jobCalls: string[] = [];
  const sessions = {
    list: async (_context: ToolContext, connectionId: number, requestedId?: string) => {
      assert.equal(connectionId, 1);
      assert.equal(requestedId, sessionId);
      return [
        {
          sessionId,
          connectionId,
          status: 'ready' as const,
          activeOperations: 0,
          createdAt: 1,
          lastUsedAt: 1,
          idleTimeoutSeconds: 1800,
        },
      ];
    },
    listJobs: async (_context: ToolContext, connectionId: number) => {
      assert.equal(connectionId, 1);
      return job ? [{ jobId: job.jobId, status: job.status, createdAt: job.createdAt }] : [];
    },
    startJob: async (
      _context: ToolContext,
      connectionId: number,
      hash: string,
      selectedSession: string,
      command: string,
      timeoutSeconds: number,
      operationHash: string,
    ): Promise<SshJobView> => {
      assert.equal(connectionId, 1);
      assert.equal(hash, sshHashes.get(1));
      assert.equal(selectedSession, sessionId);
      assert.equal(timeoutSeconds, 600);
      assert.ok(operationHash);
      jobCalls.push(command);
      job = {
        jobId,
        sessionId,
        connectionId,
        configurationHash: hash,
        status: 'running',
        result: { exitCode: null, signal: null, stdout: '', stderr: '', truncated: false, timedOut: false },
        createdAt: 1_800_000_000,
        completedAt: null,
      };
      return job;
    },
    job: async (
      _context: ToolContext,
      connectionId: number,
      requestedJob: string,
      action: 'status' | 'wait' | 'cancel',
    ) => {
      assert.equal(connectionId, 1);
      assert.equal(requestedJob, jobId);
      assert.ok(job);
      if (action === 'cancel') job = { ...job, status: 'cancelled', completedAt: 1_800_000_001 };
      return job;
    },
  } as unknown as AgentSshSessionPort;

  const registry = new CapabilityRegistry();
  let grantScope = registry.parseScope('shell.execute', {
    kind: 'targets',
    targets: { ssh: { mode: 'ids', ids: ['1', '2'] } },
  });
  const broker = {
    authorize: async (
      _scope: Scope,
      capability: string | undefined,
      resource: { target?: { target: 'ssh' | 'workspace'; id: string } },
    ) => {
      const allowed =
        capability === undefined ||
        (capability === 'shell.execute' && registry.allows('shell.execute', grantScope, resource.target));
      return allowed
        ? { allowed: true as const, policyRevision: 11 }
        : { allowed: false as const, code: 'APP_CAPABILITY_DENIED' as const, policyRevision: 11 };
    },
  } as unknown as AppCapabilityBroker;
  const service = new ShellCapabilityService(targets, shellPort, sessions);
  const catalog = new ToolCatalog();
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'scenario.ssh-only-shell',
    tools: createUnifiedShellTools(service, cryptoHash),
  });
  const executor = new ToolExecutor(catalog, broker);
  const context: ToolContext = {
    userId: 1,
    appId: 'scenario.unified-shell',
    actor: {
      kind: 'agent',
      userId: 1,
      appId: 'scenario.unified-shell',
      runId: 'shell-run',
      agentRuntimeId: 'shell-runtime',
    },
    runId: 'shell-run',
    agentRuntimeId: 'shell-runtime',
    connectionIds: [1, 2],
    environment: null,
    stepId: 'shell-step',
    toolCallId: 'shell-call',
    signal: new AbortController().signal,
    deadlineAt: Math.floor(Date.now() / 1000) + 60,
    maxOutputBytes: 128 * 1024,
    inputRevision: 1,
  };
  const proposal = (providerCallId: string, name: string, input: Record<string, JsonValue>) => ({
    providerCallId,
    name,
    argumentsJson: JSON.stringify(input),
  });
  const shellInput = (id: string, shellScript: string) => ({
    target: 'ssh',
    id,
    command: { kind: 'shell', shellScript },
    mode: 'foreground',
  });

  const one = await executor.inspect(context, proposal('one', 'shell_execute', shellInput('1', 'printf ssh-one')));
  const two = await executor.inspect(context, proposal('two', 'shell_execute', shellInput('2', 'printf ssh-two')));
  assert.notEqual(one.target.targetIdentity, two.target.targetIdentity);
  assert.notEqual(one.operationHash, two.operationHash);
  assert.equal((await executor.executeMutation(context, one)).ok, true);
  assert.equal((await executor.executeMutation(context, two)).ok, true);
  assert.deepEqual(calls, [
    { connectionId: 1, hash: 'ssh-config-one', command: 'printf ssh-one' },
    { connectionId: 2, hash: 'ssh-config-two', command: 'printf ssh-two' },
  ]);

  sshExitCode = 7;
  const nonzero = await executor.executeMutation(context, one);
  assert.equal(nonzero.ok, false);
  assert.equal(nonzero.outcome, 'confirmed');
  assert.equal(nonzero.verification.status, 'failed');
  assert.equal((nonzero.data as { exitCode: number }).exitCode, 7);
  sshExitCode = -1;
  await assert.rejects(() => executor.executeMutation(context, one), CommandExecutionError);
  sshExitCode = 0;
  sshSignal = 'TERM';
  await assert.rejects(() => executor.executeMutation(context, one), CommandExecutionError);
  sshSignal = undefined;

  const literals = ['', 'with spaces', "single'quote", '$(printf injected)', '; echo injected', '\n', '中文'];
  const quoted = await executor.inspect(
    context,
    proposal('argv', 'shell_execute', {
      target: 'ssh',
      id: '1',
      cwd: '/tmp',
      command: { kind: 'argv', argv: ['printf', '%s\\n', ...literals] },
    }),
  );
  await executor.executeMutation(context, quoted);
  assert.equal(
    execFileSync('/bin/sh', ['-c', calls.at(-1)!.command], { encoding: 'utf8' }),
    literals.join('\n') + '\n',
  );

  const destructive = await executor.inspect(
    context,
    proposal('destructive', 'shell_execute', shellInput('1', 'rm -rf scratch')),
  );
  assert.equal(destructive.risk, 'destructive');
  await assert.rejects(
    () => executor.inspect(context, proposal('forbidden', 'shell_execute', shellInput('1', 'rm -rf /'))),
    /RESOURCE_FORBIDDEN/,
  );
  const beforeOld = calls.length;
  await assert.rejects(
    () =>
      executor.inspect(
        context,
        proposal('old-target', 'shell_execute', {
          target: 'workspace',
          id: 'legacy-workspace',
          command: { kind: 'shell', shellScript: 'printf impossible' },
        }),
      ),
    /TOOL_ARGUMENTS_INVALID/,
  );
  assert.equal(calls.length, beforeOld, 'Retired Workspace cannot fall back to SSH');
  for (const [id, input, pattern] of [
    [
      'old-text',
      { ...shellInput('1', 'printf okay'), command: { kind: 'shell', text: 'private-command-canary' } },
      /TOOL_ARGUMENTS_INVALID/,
    ],
    ['invalid-timeout', { ...shellInput('1', 'sleep 1'), timeoutSeconds: 301 }, /SHELL_TIMEOUT_EXCEEDED/],
    ['background-without-session', { ...shellInput('1', 'sleep 1'), mode: 'background' }, /SSH_SESSION_REQUIRED/],
  ] as const) {
    await assert.rejects(
      () => executor.inspect(context, proposal(id, 'shell_execute', input as unknown as Record<string, JsonValue>)),
      pattern,
    );
  }
  const beforeDenied = calls.length;
  grantScope = registry.parseScope('shell.execute', {
    kind: 'targets',
    targets: { ssh: { mode: 'ids', ids: ['1'] } },
  });
  await assert.rejects(
    () => executor.inspect(context, proposal('denied', 'shell_execute', shellInput('2', 'printf denied'))),
    /APP_CAPABILITY_DENIED/,
  );
  assert.equal(calls.length, beforeDenied);
  grantScope = registry.parseScope('shell.execute', {
    kind: 'targets',
    targets: { ssh: { mode: 'ids', ids: ['1', '2'] } },
  });
  const stale = await executor.inspect(context, proposal('stale', 'shell_execute', shellInput('1', 'printf stale')));
  sshHashes.set(1, 'ssh-config-one-v2');
  await assert.rejects(() => executor.executeMutation(context, stale), /RESOURCE_CHANGED/);
  sshHashes.set(1, 'ssh-config-one');

  const background = await executor.inspect(
    context,
    proposal('background', 'shell_execute', {
      ...shellInput('1', 'sleep 20'),
      mode: 'background',
      sessionId,
      timeoutSeconds: 600,
    }),
  );
  const launched = await executor.executeMutation(context, background);
  assert.equal(launched.ok, true);
  assert.equal(launched.verification.status, 'unverified');
  assert.equal((launched.data as { executionTimeoutSeconds: number }).executionTimeoutSeconds, 600);
  assert.match(launched.summary, /expiry terminates this Job/);
  assert.deepEqual(jobCalls, ['sleep 20']);
  const list = await executor.inspect(
    context,
    proposal('job-list', 'shell_job_control', {
      target: 'ssh',
      id: '1',
      action: 'list',
    }),
  );
  const listed = await executor.execute(context, list);
  assert.equal((listed.data as { activeCount: number }).activeCount, 1);
  sshHashes.set(1, 'ssh-config-one-list-reconfigured');
  await assert.rejects(
    () => executor.execute(context, list),
    /RESOURCE_CHANGED/,
    'An inspected SSH Job list cannot rebind to a reconfigured target',
  );
  sshHashes.set(1, 'ssh-config-one');
  const status = await executor.inspect(
    context,
    proposal('job-status', 'shell_job_control', {
      target: 'ssh',
      id: '1',
      action: 'status',
      jobId,
    }),
  );
  assert.equal((await executor.execute(context, status)).verification.status, 'unverified');
  sshHashes.set(1, 'ssh-config-one-job-reconfigured');
  await assert.rejects(
    () => executor.execute(context, status),
    /RESOURCE_CHANGED/,
    'An already inspected SSH Job cannot rebind to a reconfigured SSH target',
  );
  sshHashes.set(1, 'ssh-config-one');
  const cancel = await executor.inspect(
    context,
    proposal('job-cancel', 'shell_job_control', {
      target: 'ssh',
      id: '1',
      action: 'cancel',
      jobId,
    }),
  );
  assert.equal((await executor.execute(context, cancel)).verification.status, 'failed');
  await assert.rejects(
    () =>
      executor.inspect(
        context,
        proposal('old-job-id', 'shell_job_control', {
          target: 'ssh',
          id: '1',
          action: 'status',
          jobId: 'job-' + 'b'.repeat(64),
        }),
      ),
    /SHELL_JOB_ID_INVALID/,
  );
  await assert.rejects(
    () =>
      executor.inspect(
        context,
        proposal('old-job-target', 'shell_job_control', {
          target: 'workspace',
          id: 'old-workspace',
          action: 'list',
        }),
      ),
    /TOOL_ARGUMENTS_INVALID/,
  );
  return [
    { name: 'unified_shell_targets', value: 2, unit: 'ssh-connections' },
    { name: 'unified_shell_confirmed_nonzero_unknown', value: 3, unit: 'cases' },
    { name: 'unified_shell_scope_and_stale_rejections', value: 4, unit: 'cases' },
    { name: 'unified_shell_background_job_lifecycle', value: 4, unit: 'cases' },
    { name: 'unified_shell_retired_target_rejections', value: 2, unit: 'cases' },
  ];
};
