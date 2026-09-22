import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { JsonValue } from '../../../packages/backend/src/modules/agent/agent.types';
import type { ToolContext } from '../../../packages/backend/src/modules/agent/capabilities/tool.types';
import { createBrowserTools } from '../../../packages/backend/src/modules/agent/tools/host/browser-tools';

export const browserTargetScopedRevisionScenario = async () => {
  const cryptoHash = { sha256Utf8: (value: string) => createHash('sha256').update(value, 'utf8').digest('hex') };
  const runId = randomUUID();
  const agentRuntimeId = randomUUID();
  const sessionId = randomUUID();
  const workspaceId = randomUUID();
  const context: ToolContext = {
    userId: 1,
    appId: 'browser-target-revision-app',
    actor: { kind: 'agent', userId: 1, appId: 'browser-target-revision-app', runId, agentRuntimeId },
    runId,
    agentRuntimeId,
    connectionIds: [],
    environment: null,
    stepId: 'browser-target-revision-step',
    signal: new AbortController().signal,
    deadlineAt: Math.floor(Date.now() / 1000) + 120,
    maxOutputBytes: 65_536,
    inputRevision: 0,
  };
  const initialTarget = {
    id: 'target-scoped',
    endpoints: [
      {
        scope: 'external-network' as const,
        via: 'backend' as const,
        url: 'https://browser.example.test/',
        priority: 1,
        allowPlaintext: false,
        verifyTls: true,
      },
    ],
    allowedUrlPatterns: ['https://example.test/*'],
  };
  let configuredTarget = structuredClone(initialTarget);
  let targetAvailable = true;
  let settingsRevision = 7;
  const settings = {
    get: async () => ({
      revision: settingsRevision,
      effectiveSettings: {
        browser: { targets: targetAvailable ? [structuredClone(configuredTarget)] : [] },
      },
    }),
  };
  const workspace = {
    id: workspaceId,
    runId,
    agentRuntimeId,
    generation: 3,
    status: 'running',
    profile: {
      browserTarget: {
        id: 'workspace-frozen-target',
        profileRevision: 42,
        endpoints: [
          {
            scope: 'docker-network' as const,
            via: 'runner' as const,
            url: 'http://browser.internal:9222/',
            priority: 1,
            allowPlaintext: true,
            verifyTls: true,
          },
        ],
        allowedUrlPatterns: ['https://workspace.example.test/*'],
      },
    },
  };
  const repository = {
    getWorkspace: async (_scope: unknown, requestedWorkspaceId: string) =>
      requestedWorkspaceId === workspaceId ? workspace : null,
  };
  let session: import('../../../packages/backend/src/modules/agent/ai/integrations.types').BrowserSessionView | null =
    null;
  let closeCount = 0;
  const gateway = {
    createSession: async (
      request: import('../../../packages/backend/src/modules/agent/ai/integrations.types').BrowserSessionRequest,
    ) => {
      session = {
        userId: request.userId,
        appId: request.appId,
        runId: request.runId,
        agentRuntimeId: request.agentRuntimeId,
        sessionId,
        targetId: request.target.id,
        targetRevision: request.target.profileRevision,
        targetConfigurationHash: request.target.configurationHash,
        workspaceId: request.workspaceId ?? null,
        generation: request.generation ?? null,
        url: 'about:blank',
        createdAt: 1_800_000_000,
      };
      return session;
    },
    getSession: async () => {
      if (!session) throw new Error('BROWSER_SESSION_NOT_FOUND');
      return session;
    },
    close: async () => {
      closeCount += 1;
    },
  };
  const tools = createBrowserTools(repository as never, settings as never, gateway as never, cryptoHash);
  const createTool = tools.find((tool) => tool.descriptor.name === 'browser_create_session')!;
  const snapshotTool = tools.find((tool) => tool.descriptor.name === 'browser_snapshot')!;

  const createInspection = await createTool.inspect({ targetId: initialTarget.id }, context, 1);
  const initialNormalized = createInspection.normalizedArguments as Record<string, JsonValue>;
  settingsRevision = 8;
  const sameTargetInspection = await createTool.inspect({ targetId: initialTarget.id }, context, 1);
  const sameNormalized = sameTargetInspection.normalizedArguments as Record<string, JsonValue>;
  assert.equal(
    sameTargetInspection.operationHash,
    createInspection.operationHash,
    'unrelated Agent Settings revision changes must not alter Browser target operation identity',
  );
  assert.equal(sameNormalized.targetRevision, initialNormalized.targetRevision);
  assert.equal(sameNormalized.targetConfigurationHash, initialNormalized.targetConfigurationHash);

  await assert.doesNotReject(
    () => createTool.execute(createInspection, context),
    'P-107 requires unrelated Agent Settings revision changes to preserve a standalone Browser target identity',
  );
  await assert.doesNotReject(
    () => snapshotTool.inspect({ sessionId }, context, 1),
    'an existing standalone Browser session must survive an unrelated settings revision change',
  );
  assert.equal(closeCount, 0);

  settingsRevision = 9;
  configuredTarget = {
    ...configuredTarget,
    endpoints: [{ ...configuredTarget.endpoints[0]!, url: 'https://browser-changed.example.test/' }],
  };
  await assert.rejects(
    () => snapshotTool.inspect({ sessionId }, context, 1),
    /BROWSER_TARGET_STALE/,
    'changing the selected Browser target endpoint must stale the old standalone session',
  );
  assert.equal(closeCount, 1);

  const changedTargetInspection = await createTool.inspect({ targetId: initialTarget.id }, context, 1);
  await createTool.execute(changedTargetInspection, context);
  targetAvailable = false;
  settingsRevision = 10;
  await assert.rejects(
    () => snapshotTool.inspect({ sessionId }, context, 1),
    /BROWSER_TARGET_STALE/,
    'deleting the selected Browser target must close and stale the old standalone session',
  );
  assert.equal(closeCount, 2);

  const workspaceInspection = await createTool.inspect({ workspaceId }, context, 1);
  const workspaceNormalized = workspaceInspection.normalizedArguments as Record<string, JsonValue>;
  assert.equal(
    workspaceNormalized.targetRevision,
    42,
    'Workspace Browser target must keep its frozen profile revision',
  );
  await createTool.execute(workspaceInspection, context);
  settingsRevision = 11;
  await assert.doesNotReject(
    () => snapshotTool.inspect({ sessionId }, context, 1),
    'Workspace-bound Browser session must remain governed by frozen workspace target/generation, not global settings revision',
  );
  assert.equal(closeCount, 2);

  return [
    { name: 'browser_unrelated_settings_revision_survivals', value: 1, unit: 'sessions' },
    { name: 'browser_target_operation_identity_survivals', value: 1, unit: 'operations' },
    { name: 'browser_target_content_stale_rejections', value: 1, unit: 'sessions' },
    { name: 'browser_target_deletion_stale_rejections', value: 1, unit: 'sessions' },
    { name: 'browser_workspace_frozen_revision_preservations', value: 1, unit: 'sessions' },
    { name: 'browser_spurious_session_closes', value: 0, unit: 'sessions' },
  ];
};
