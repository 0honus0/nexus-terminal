import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { JsonValue, Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import { SshShellTargetAdapter } from '../../../packages/backend/src/infrastructure/agent/capabilities/ssh-shell-target.adapter';
import type { AgentSshSessions } from '../../../packages/backend/src/infrastructure/agent/capabilities/agent-ssh-sessions';
import type { AgentConnectionResolverPort } from '../../../packages/backend/src/modules/agent/capabilities/ssh-target-resolver.port';
import { CommandExecutionError } from '../../../packages/backend/src/platform/execution/remote-execution.port';
import type { ExecutionSession } from '../../../packages/backend/src/platform/execution/execution-session';
import { ShellCapabilityService } from '../../../packages/backend/src/modules/agent/capabilities/shell-capability.service';
import { AgentTargetResolver } from '../../../packages/backend/src/modules/agent/capabilities/target-resolver';
import { ToolCatalog } from '../../../packages/backend/src/modules/agent/capabilities/tool-catalog';
import { ToolExecutor } from '../../../packages/backend/src/modules/agent/capabilities/tool-executor';
import type { ToolContext } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { AppCapabilityBroker } from '../../../packages/backend/src/modules/agent/host/app-capability-broker';
import { CapabilityRegistry } from '../../../packages/backend/src/modules/agent/host/capability-registry';
import { createUnifiedShellTools } from '../../../packages/backend/src/modules/agent/tools/host/shell-tools';
import type { WorkspaceShellTargetPort } from '../../../packages/backend/src/modules/agent/workspace-runtime/workspace-shell-target.port';

export const unifiedShellCapabilityScenario = async () => {
  let workspaceGeneration = 3;
  const sshHashes = new Map<number, string>([
    [1, 'ssh-config-one'],
    [2, 'ssh-config-two'],
  ]);
  const workspaceCalls: Array<{ workspaceId: string; generation: number; argv: string[] }> = [];
  const executionIds: string[] = [];
  const sshCalls: Array<{ connectionId: number; hash: string; command: string }> = [];
  const cryptoHash = {
    sha256Utf8: (value: string) => createHash('sha256').update(value, 'utf8').digest('hex'),
  };

  const targets = {
    resolve: async (context: ToolContext, selector: { target: 'workspace' | 'ssh'; id: string }) => {
      if (selector.target === 'workspace') {
        if (selector.id !== 'ws-shell') throw new Error('NOT_FOUND');
        return {
          selector,
          fingerprint: {
            kind: 'workspace' as const,
            target: 'workspace' as const,
            id: selector.id,
            workspaceId: selector.id,
            generation: workspaceGeneration,
            targetIdentity: `workspace:${selector.id}:${workspaceGeneration}`,
            endpoint: `workspace:${selector.id}`,
            loginUser: 'runner:65532',
            configurationHash: `workspace-config-${workspaceGeneration}`,
          },
          resourceKeys: [`workspace:${selector.id}:${workspaceGeneration}`],
          preconditions: [
            {
              kind: 'workspaceGeneration' as const,
              key: selector.id,
              observedValue: { generation: workspaceGeneration },
            },
          ],
          workspaceGeneration,
        };
      }
      const connectionId = Number(selector.id);
      if (!Number.isSafeInteger(connectionId) || !context.connectionIds?.includes(connectionId)) {
        throw new Error('TARGET_NOT_SELECTED');
      }
      const configurationHash = sshHashes.get(connectionId);
      if (!configurationHash) throw new Error('NOT_FOUND');
      return {
        selector,
        fingerprint: {
          kind: 'ssh' as const,
          target: 'ssh' as const,
          id: selector.id,
          connectionId,
          targetIdentity: `ssh:${connectionId}`,
          endpoint: `ssh-${connectionId}.example:22`,
          loginUser: `user-${connectionId}`,
          configurationHash,
          hostKeyTrust: 'unavailable' as const,
        },
        resourceKeys: [`connection:${connectionId}`],
        preconditions: [],
        connectionId,
      };
    },
  } as unknown as AgentTargetResolver;

  const workspaceShellTarget = {
    execute: async (
      _context: ToolContext,
      workspaceId: string,
      generation: number,
      call: { argv: string[]; cwd: string; executionId: string },
      mode: 'foreground' | 'background',
    ) => {
      if (mode !== 'foreground') throw new Error('UNEXPECTED_BACKGROUND_JOB');
      if (workspaceId !== 'ws-shell' || generation !== workspaceGeneration) {
        throw new Error('WORKSPACE_GENERATION_CONFLICT');
      }
      executionIds.push(call.executionId);
      workspaceCalls.push({ workspaceId, generation, argv: [...call.argv] });
      return {
        jobId: 'job-' + 'b'.repeat(64),
        workspaceId,
        generation,
        status: 'succeeded' as const,
        result: {
          exitCode: 0,
          signal: null,
          stdout: 'workspace-ok\n',
          stderr: '',
          truncated: false,
          timedOut: false,
        },
        error: null,
        createdAt: 1_800_000_000,
        completedAt: 1_800_000_001,
      };
    },
  } as unknown as WorkspaceShellTargetPort;

  let sshExitCode = 0;
  let sshSignal: string | undefined;
  const sshShellTarget = new SshShellTargetAdapter(
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
            sshCalls.push({ connectionId, hash: expectedConfigurationHash, command });
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

  const registry = new CapabilityRegistry();
  let grantScope = registry.parseScope('shell.execute', {
    kind: 'targets',
    targets: { workspace: { mode: 'all' }, ssh: { mode: 'ids', ids: ['1', '2'] } },
  });
  const broker = {
    authorize: async (
      _scope: Scope,
      capability: string | undefined,
      resource: { target?: { target: 'workspace' | 'ssh'; id: string } },
    ) => {
      const allowed =
        capability === undefined ||
        (capability === 'shell.execute' && registry.allows('shell.execute', grantScope, resource.target));
      return allowed
        ? { allowed: true as const, policyRevision: 11 }
        : { allowed: false as const, code: 'APP_CAPABILITY_DENIED' as const, policyRevision: 11 };
    },
  } as unknown as AppCapabilityBroker;

  const service = new ShellCapabilityService(targets, workspaceShellTarget, sshShellTarget, cryptoHash);
  const catalog = new ToolCatalog();
  catalog.registerContribution({
    schemaVersion: 1,
    id: 'scenario.unified-shell',
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
    environment: {
      kind: 'code',
      recipeId: 'shell-recipe',
      recipeRevision: '1',
      runtimeDigest: 'shell-runtime-digest',
      catalogRevision: 'shell-catalog',
      toolchain: [],
      runnerPlugins: [],
      acpProfiles: [],
      browserTarget: null,
    },
    stepId: 'shell-step',
    toolCallId: 'shell-call',
    signal: new AbortController().signal,
    deadlineAt: Math.floor(Date.now() / 1000) + 60,
    maxOutputBytes: 128 * 1024,
    inputRevision: 1,
  };
  const proposal = (providerCallId: string, input: Record<string, JsonValue>) => ({
    providerCallId,
    name: 'shell_execute',
    argumentsJson: JSON.stringify(input),
  });

  const workspaceInspection = await executor.inspect(
    context,
    proposal('workspace-exec', {
      target: 'workspace',
      id: 'ws-shell',
      command: { kind: 'argv', argv: ['printf', 'workspace'] },
      mode: 'foreground',
    }),
  );
  const sshOneInspection = await executor.inspect(
    context,
    proposal('ssh-one-exec', {
      target: 'ssh',
      id: '1',
      command: { kind: 'shell', text: 'printf ssh-one' },
      mode: 'foreground',
    }),
  );
  const sshTwoInspection = await executor.inspect(
    context,
    proposal('ssh-two-exec', {
      target: 'ssh',
      id: '2',
      command: { kind: 'shell', text: 'printf ssh-two' },
      mode: 'foreground',
    }),
  );
  assert.notEqual(workspaceInspection.target.targetIdentity, sshOneInspection.target.targetIdentity);
  assert.notEqual(sshOneInspection.target.targetIdentity, sshTwoInspection.target.targetIdentity);
  assert.notEqual(workspaceInspection.operationHash, sshOneInspection.operationHash);
  assert.notEqual(sshOneInspection.operationHash, sshTwoInspection.operationHash);

  const workspaceResult = await executor.executeMutation(context, workspaceInspection);
  const sshOneResult = await executor.executeMutation(context, sshOneInspection);
  const sshTwoResult = await executor.executeMutation(context, sshTwoInspection);
  assert.deepEqual(workspaceResult.semantic, {
    kind: 'execution',
    target: { target: 'workspace', id: 'ws-shell' },
    status: 'succeeded',
    job: { jobId: 'job-' + 'b'.repeat(64), workspaceId: 'ws-shell', generation: 3 },
  });
  assert.deepEqual(sshOneResult.semantic, {
    kind: 'execution',
    target: { target: 'ssh', id: '1' },
    status: 'succeeded',
  });
  assert.deepEqual(sshTwoResult.semantic, {
    kind: 'execution',
    target: { target: 'ssh', id: '2' },
    status: 'succeeded',
  });
  assert.deepEqual(workspaceCalls, [{ workspaceId: 'ws-shell', generation: 3, argv: ['printf', 'workspace'] }]);
  assert.deepEqual(sshCalls, [
    { connectionId: 1, hash: 'ssh-config-one', command: 'printf ssh-one' },
    { connectionId: 2, hash: 'ssh-config-two', command: 'printf ssh-two' },
  ]);

  await executor.executeMutation(context, workspaceInspection);
  await executor.executeMutation({ ...context, toolCallId: 'fresh-shell-call' }, workspaceInspection);
  assert.equal(executionIds[0], executionIds[1], 'Same durable call retains execution identity');
  assert.notEqual(
    executionIds[0],
    executionIds[2],
    'New durable call changes identity even with identical approval hash',
  );

  sshExitCode = 7;
  const nonzeroResult = await executor.executeMutation(context, sshOneInspection);
  assert.equal(nonzeroResult.ok, false);
  assert.equal(nonzeroResult.outcome, 'confirmed');
  assert.deepEqual(nonzeroResult.semantic, {
    kind: 'execution',
    target: { target: 'ssh', id: '1' },
    status: 'failed',
  });
  assert.equal((nonzeroResult.data as { exitCode: number }).exitCode, 7);
  assert.equal((nonzeroResult.data as { stderr: string }).stderr, 'EXPECTED_FAILURE\n');
  assert.equal(nonzeroResult.verification?.status, 'failed');
  sshExitCode = -1;
  await assert.rejects(() => executor.executeMutation(context, sshOneInspection), CommandExecutionError);
  sshExitCode = 0;
  sshSignal = 'TERM';
  await assert.rejects(() => executor.executeMutation(context, sshOneInspection), CommandExecutionError);
  sshSignal = undefined;
  assert.equal((await executor.executeMutation(context, sshOneInspection)).ok, true);

  for (const [callId, input] of [
    ['workspace-shell-text', { target: 'workspace', id: 'ws-shell', command: { kind: 'shell', text: 'echo invalid' } }],
    ['ssh-argv', { target: 'ssh', id: '1', command: { kind: 'argv', argv: ['echo', 'invalid'] } }],
    ['ssh-background', { target: 'ssh', id: '1', command: { kind: 'shell', text: 'sleep 1' }, mode: 'background' }],
  ] as const) {
    await assert.rejects(
      () => executor.inspect(context, proposal(callId, input as unknown as Record<string, JsonValue>)),
      callId === 'ssh-background' ? /SSH_SESSION_REQUIRED/ : /TOOL_ARGUMENTS_INVALID/,
    );
  }

  grantScope = registry.parseScope('shell.execute', {
    kind: 'targets',
    targets: { workspace: { mode: 'all' }, ssh: { mode: 'ids', ids: ['1'] } },
  });
  await assert.rejects(
    () =>
      executor.inspect(
        context,
        proposal('ssh-two-denied', {
          target: 'ssh',
          id: '2',
          command: { kind: 'shell', text: 'printf denied' },
        }),
      ),
    /APP_CAPABILITY_DENIED/,
  );
  grantScope = registry.parseScope('shell.execute', {
    kind: 'targets',
    targets: { workspace: { mode: 'all' }, ssh: { mode: 'ids', ids: ['1', '2'] } },
  });

  const staleWorkspace = await executor.inspect(
    context,
    proposal('stale-workspace', {
      target: 'workspace',
      id: 'ws-shell',
      command: { kind: 'argv', argv: ['printf', 'stale'] },
    }),
  );
  workspaceGeneration = 4;
  await assert.rejects(() => executor.executeMutation(context, staleWorkspace), /WORKSPACE_GENERATION_CONFLICT/);
  workspaceGeneration = 3;

  const staleSsh = await executor.inspect(
    context,
    proposal('stale-ssh', {
      target: 'ssh',
      id: '1',
      command: { kind: 'shell', text: 'printf stale' },
    }),
  );
  sshHashes.set(1, 'ssh-config-one-v2');
  await assert.rejects(() => executor.executeMutation(context, staleSsh), /RESOURCE_CHANGED/);

  return [
    { name: 'unified_shell_targets', value: 3, unit: 'targets' },
    { name: 'unified_shell_isolated_results', value: 3, unit: 'results' },
    { name: 'unified_shell_confirmed_nonzero_and_unknown_results', value: 4, unit: 'cases' },
    { name: 'unified_shell_transport_rejections', value: 3, unit: 'cases' },
    { name: 'unified_shell_scope_rejections', value: 1, unit: 'cases' },
    { name: 'unified_shell_stale_target_rejections', value: 2, unit: 'cases' },
    { name: 'unified_shell_legacy_branches', value: 0, unit: 'branches' },
  ];
};
