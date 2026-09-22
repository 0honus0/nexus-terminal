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
