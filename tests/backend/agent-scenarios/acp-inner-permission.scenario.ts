import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Scope } from '../../../packages/backend/src/modules/agent/agent.types';
import type { ToolContext, ToolInspection } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import type { AgentWorkspaceRepositoryPort } from '../../../packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.repository.port';
import type { IntegrationRepositoryPort } from '../../../packages/backend/src/modules/agent/ai/integration.repository.port';
import type {
  AcpRuntimePort,
  IntegrationView,
} from '../../../packages/backend/src/modules/agent/ai/integrations.types';
import { createAcpExecuteTool } from '../../../packages/backend/src/modules/agent/tools/host/acp-tools';
import type { AgentTargetResolver } from '../../../packages/backend/src/modules/agent/capabilities/target-resolver';
import { SshAcpTransport } from '../../../packages/backend/src/infrastructure/agent/integrations/ssh-acp-transport';
import type { ExecutionSessionManager } from '../../../packages/backend/src/platform/execution/execution-session-manager';
import type { AgentConnectionResolverPort } from '../../../packages/backend/src/modules/agent/capabilities/ssh-target-resolver.port';

export const acpInnerPermissionScenario = async () => {
  const scope: Scope = { userId: 1, appId: 'acp-inner-permission-app' };
  const runId = 'acp-inner-permission-run';
  const runtimeId = 'acp-inner-permission-runtime';
  const integrationId = '00000000-0000-4000-8000-000000000108';
  const workspaceId = 'acp-inner-permission-workspace';
  const integration: IntegrationView = {
    ...scope,
    id: integrationId,
    kind: 'acp',
    configuration: {
      displayName: 'scenario-acp',
      transport: 'workspace-profile',
      profileId: 'scenario-acp-profile',
      protocolVersion: '1',
    },
    hasCredential: false,
    credentialRevision: 1,
    schemaHash: null,
    enabled: true,
    version: 1,
    createdAt: 1_801_100_000,
    updatedAt: 1_801_100_000,
  };
  const integrations = {
    get: async () => integration,
  } as unknown as IntegrationRepositoryPort;
  const workspaces = {
    getWorkspace: async () =>
      ({
        id: workspaceId,
        ...scope,
        runId,
        agentRuntimeId: runtimeId,
        generation: 1,
        version: 1,
        status: 'running',
        profile: {
          acpProfiles: [
            {
              id: 'scenario-acp-profile',
              profileRevision: 1,
              argv: ['scenario-acp'],
              cwd: '/workspace/work',
            },
          ],
        },
      }) as never,
  } as unknown as AgentWorkspaceRepositoryPort;
  const decisions: Array<'allow_once' | 'reject_once'> = [];
  let permissionRequests = 0;
  const runtime: AcpRuntimePort = {
    execute: async (_integration, _request, context) => {
      decisions.push(
        await context.requestPermission({
          sessionId: 'session-108',
          toolCallId: 'inner-tool-108',
          title: 'Write generated source',
          kind: 'edit',
          rawInput: { path: '/workspace/work/generated.ts', bytes: 128 },
        }),
      );
      return { text: 'permission scenario complete', stopReason: 'end_turn' };
    },
  };
  const tool = createAcpExecuteTool(
    integrations,
    workspaces,
    runtime,
    { sha256Utf8: (value) => createHash('sha256').update(value, 'utf8').digest('hex') },
    {
      request: async (toolContext, parentInspection, request) => {
        permissionRequests += 1;
        assert.equal(toolContext.toolCallId, 'outer-tool-108');
        assert.equal(parentInspection.operationHash, 'scenario-outer-operation-hash');
        assert.equal(request.sessionId, 'session-108');
        assert.equal(request.toolCallId, 'inner-tool-108');
        return 'allow_once';
      },
    },
  );
  const inspection: ToolInspection = {
    toolName: 'acp_execute',
    toolVersion: '1.0.0',
    normalizedArguments: {
      integrationId,
      integrationVersion: 1,
      workspaceId,
      generation: 1,
      profileId: 'scenario-acp-profile',
      profileRevision: 1,
      prompt: 'implement the requested change',
      cwd: '/workspace/work',
    },
    target: {
      kind: 'integration',
      integrationId,
      workspaceId,
      generation: 1,
      targetIdentity: `acp:${integrationId}:${workspaceId}:1:scenario-acp-profile`,
      endpoint: `workspace-acp:${workspaceId}:scenario-acp-profile`,
      loginUser: 'runner:acp',
      configurationHash: 'scenario-acp-configuration',
    },
    resourceKeys: [`integration:acp:${integrationId}`, `workspace:${workspaceId}:1`],
    risk: 'mutate',
    mutation: true,
    operationHash: 'scenario-outer-operation-hash',
    operationHashVersion: 1,
    preconditions: [],
    policyRevision: 1,
    inputRevision: 1,
  };
  const abort = new AbortController();
  const context: ToolContext = {
    ...scope,
    actor: { kind: 'agent', userId: 1, appId: scope.appId, runId, agentRuntimeId: runtimeId },
    runId,
    agentRuntimeId: runtimeId,
    toolCallId: 'outer-tool-108',
    connectionIds: [],
    environment: null,
    stepId: 'acp-inner-permission-step',
    signal: abort.signal,
    deadlineAt: 1_801_100_600,
    maxOutputBytes: 64 * 1024,
    inputRevision: 1,
  };

  await tool.execute(inspection, context);
  assert.deepEqual(
    decisions,
    ['allow_once'],
    'an explicit user-approved ACP inner action must resume the original ACP permission request',
  );

  const sshIntegration: IntegrationView = {
    ...integration,
    configuration: {
      displayName: 'SSH ACP',
      transport: 'ssh',
      profileId: 'ssh-acp',
      protocolVersion: '1',
      argv: ['agent', '--acp'],
      cwd: '/srv/project',
    },
  };
  let stdout: ((bytes: Uint8Array) => void) | undefined;
  let disconnected: (() => void) | undefined;
  let startedCommand = '';
  let terminated = 0;
  let closed = 0;
  const transportFixture = new SshAcpTransport(
    {
      resolve: async () => ({}),
      get: async () => ({ configurationHash: 'ssh-config' }),
    } as unknown as AgentConnectionResolverPort,
    {
      connect: async () => ({
        id: 'ssh-acp-fixture',
        onTransportClose: (listener: () => void) => {
          disconnected = listener;
          return () => {};
        },
        startCommand: async (request: { command: string; pty: boolean }) => {
          assert.equal(request.pty, false);
          startedCommand = request.command;
          return {
            write: () => true,
            onStdout: (listener: (bytes: Uint8Array) => void) => {
              stdout = listener;
              return () => {};
            },
            onError: () => () => {},
            onClose: () => () => {},
            terminate: async () => {
              terminated++;
            },
          };
        },
      }),
      close: async () => {
        closed++;
      },
    } as unknown as ExecutionSessionManager,
  );
  const byteTransport = await transportFixture.open(
    { ...context, deadlineAt: Math.floor(Date.now() / 1000) + 60 },
    1,
    'ssh-config',
    ['agent', "argument'quote", '$(not-run)'],
    '/srv/project',
  );
  assert.match(startedCommand, /exec 'agent'/);
  assert.ok(startedCommand.includes("'$(not-run)'"));
  const reader = byteTransport.readable.getReader();
  stdout!(new TextEncoder().encode('{"jsonrpc":"2.0"}\n'));
  assert.equal(new TextDecoder().decode((await reader.read()).value), '{"jsonrpc":"2.0"}\n');
  disconnected!();
  await assert.rejects(() => reader.read(), /ACP_SSH_DISCONNECTED/);
  await Promise.all([byteTransport.close(), byteTransport.close()]);
  assert.equal(terminated, 1);
  assert.equal(closed, 1);
  const cancelController = new AbortController();
  const cancelledTransport = await transportFixture.open(
    { ...context, signal: cancelController.signal, deadlineAt: Math.floor(Date.now() / 1000) + 60 },
    1,
    'ssh-config',
    ['agent'],
    '/srv/project',
  );
  const cancelledReader = cancelledTransport.readable.getReader();
  const pendingRead = cancelledReader.read();
  cancelController.abort();
  await assert.rejects(() => pendingRead, /ABORTED/);
  await cancelledTransport.close();
  assert.equal(terminated, 2);
  assert.equal(closed, 2);
  const overflowTransport = await transportFixture.open(
    { ...context, deadlineAt: Math.floor(Date.now() / 1000) + 60 },
    1,
    'ssh-config',
    ['agent'],
    '/srv/project',
  );
  stdout!(new Uint8Array(256 * 1024 + 1));
  await assert.rejects(() => overflowTransport.readable.getReader().read(), /ACP_SSH_STREAM_OVERFLOW/);
  await overflowTransport.close();
  let sshPermissionRequests = 0;
  const sshTool = createAcpExecuteTool(
    { get: async () => sshIntegration } as unknown as IntegrationRepositoryPort,
    workspaces,
    {
      execute: async (_integration, request, execution) => {
        assert.equal(request.cwd, '/srv/project');
        assert.ok(execution.openTransport);
        assert.equal(
          await execution.requestPermission({
            sessionId: 'ssh-session',
            toolCallId: 'ssh-inner',
            title: 'edit',
            kind: 'edit',
            rawInput: null,
          }),
          'reject_once',
        );
        return { text: 'SSH complete', stopReason: 'end_turn' };
      },
    },
    { sha256Utf8: (value) => createHash('sha256').update(value).digest('hex') },
    {
      request: async () => {
        sshPermissionRequests++;
        return 'reject_once';
      },
    },
    {
      targets: {
        resolve: async (_context: ToolContext, selector: { id: string }) => {
          assert.equal(selector.id, '1');
          return {
            selector: { target: 'ssh', id: '1' },
            connectionId: 1,
            resourceKeys: ['connection:1'],
            preconditions: [],
            fingerprint: {
              kind: 'ssh',
              target: 'ssh',
              id: '1',
              connectionId: 1,
              targetIdentity: 'ssh:1',
              endpoint: 'fixture',
              loginUser: 'fixture',
              configurationHash: 'ssh-config',
            },
          };
        },
      } as unknown as AgentTargetResolver,
      open: async () => {
        throw new Error('Transport fixture not invoked by mocked runtime');
      },
    },
  );
  const sshInspection = await sshTool.inspect(
    { integrationId, target: 'ssh', id: '1', prompt: 'inspect' },
    { ...context, connectionIds: [1] },
    1,
  );
  assert.ok(sshInspection.resourceKeys.includes('connection:1'));
  const sshResult = await sshTool.execute(sshInspection, { ...context, connectionIds: [1] });
  assert.equal(sshResult.ok, true);
  assert.equal(sshPermissionRequests, 1);
  sshIntegration.version++;
  await assert.rejects(() => sshTool.execute(sshInspection, context), /RESOURCE_CHANGED/);
  await assert.rejects(
    () => sshTool.inspect({ integrationId, workspaceId, prompt: 'inspect' }, context, 1),
    /ACP_TARGET_CONFIGURATION_MISMATCH/,
  );

  return [
    { name: 'acp_inner_permission_requests', value: decisions.length, unit: 'requests' },
    { name: 'acp_inner_permission_broker_requests', value: permissionRequests, unit: 'requests' },
    {
      name: 'acp_inner_permission_allow_once',
      value: decisions.filter((decision) => decision === 'allow_once').length,
      unit: 'decisions',
    },
  ];
};
