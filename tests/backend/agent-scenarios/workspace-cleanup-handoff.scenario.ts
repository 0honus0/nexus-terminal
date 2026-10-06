import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import express from '../../../packages/backend/node_modules/express';
import {
  createAppRuntimeRouter,
  type AppRuntimeRouterDependencies,
} from '../../../packages/backend/src/interfaces/http/agent/app-runtime.routes';
import type {
  AgentWorkspaceView,
  WorkspaceRuntimeCommandView,
} from '../../../packages/backend/src/modules/agent/workspace-runtime/workspace-runtime.types';
import { scope } from './scenario-fixtures';

// Controlled facade settlement validates the production HTTP handoff contract,
// not Runner process cleanup. Real deployment/PID evidence is recorded separately.
export const workspaceCleanupHandoffScenario = async () => {
  let workspace: AgentWorkspaceView = {
    ...scope,
    id: 'handoff-workspace',
    runId: 'finished-run',
    agentRuntimeId: 'finished-runtime',
    retained: false,
    retainedManifestRef: null,
    profile: {
      kind: 'code',
      recipeId: 'scenario',
      recipeRevision: '1',
      runtimeDigest: 'scenario',
      catalogRevision: 'scenario',
      toolchain: [],
      runnerPlugins: [],
      acpProfiles: [],
      browserTarget: null,
    },
    generation: 1,
    status: 'running',
    version: 3,
    lastActiveAt: 1,
    createdAt: 1,
    updatedAt: 1,
  };
  let command: WorkspaceRuntimeCommandView | undefined;
  let actionCalls = 0;
  const facade = {
    getWorkspace: async (requestedScope: typeof scope, id: string) => {
      assert.deepEqual(requestedScope, scope);
      assert.equal(id, workspace.id);
      return workspace;
    },
    action: async (requestedScope: typeof scope, id: string, action: 'stop' | 'delete', version: number) => {
      assert.deepEqual(requestedScope, scope);
      assert.equal(id, workspace.id);
      if (version !== workspace.version) throw new Error('STATE_CONFLICT');
      actionCalls += 1;
      command = {
        ...scope,
        id: randomUUID(),
        workspaceId: id,
        action,
        operationHash: 'a'.repeat(64),
        generation: workspace.generation,
        status: 'running',
        result: null,
        deadlineAt: 120,
        createdAt: 1,
        completedAt: null,
      };
      workspace = { ...workspace, version: workspace.version + 1, status: action === 'stop' ? 'stopping' : 'deleting' };
      return command;
    },
    getCommand: async (requestedScope: typeof scope, id: string) => {
      assert.deepEqual(requestedScope, scope);
      if (!command || id !== command.id) throw new Error('NOT_FOUND');
      return command;
    },
  };
  const secret = 'handoff-csrf-secret';
  const sessionId = 'handoff-session';
  const csrf = createHmac('sha256', secret).update('nexus-agent-csrf-v1\0').update(sessionId).digest('hex');
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.session = { userId: scope.userId, username: 'handoff-user' } as typeof request.session;
    request.sessionID = sessionId;
    next();
  });
  app.use(
    '/api/v1/apps/:appId',
    createAppRuntimeRouter({
      runs: {} as AppRuntimeRouterDependencies['runs'],
      approvals: {} as AppRuntimeRouterDependencies['approvals'],
      workspaceRuntime: facade as unknown as AppRuntimeRouterDependencies['workspaceRuntime'],
      nodeEnv: 'test',
      csrfSecret: secret,
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api/v1/apps/${scope.appId}`;
    const readWorkspace = async () => {
      const response = await fetch(`${base}/workspaces/${workspace.id}`);
      assert.equal(response.status, 200);
      return (await response.json()).data;
    };
    const post = (body: unknown, token = csrf) =>
      fetch(`${base}/workspaces/${workspace.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Nexus-CSRF': token, 'Idempotency-Key': randomUUID() },
        body: JSON.stringify(body),
      });
    const initial = await readWorkspace();
    assert.equal(typeof initial.version, 'number');
    assert.equal(
      (await post({ schemaVersion: 1, expectedVersion: initial.version, action: 'stop' }, 'invalid')).status,
      403,
    );
    const invalidVersion = await post({ schemaVersion: 1, expectedVersion: String(initial.version), action: 'stop' });
    assert.equal(invalidVersion.status, 400);
    assert.equal(actionCalls, 0, 'invalid handoff requests must not dispatch a lifecycle action');
    for (const action of ['stop', 'delete'] as const) {
      const current = await readWorkspace();
      const response = await post({ schemaVersion: 1, expectedVersion: current.version, action });
      assert.equal(response.status, 202);
      const accepted = (await response.json()).data;
      assert.equal(typeof accepted.id, 'string');
      assert.equal(accepted.commandId, undefined);
      assert.equal(accepted.status, 'running');
      const commandPath = `${base}/workspace-runtime/commands/${accepted.id}`;
      assert.equal((await (await fetch(commandPath)).json()).data.status, 'running');
      assert.equal((await readWorkspace()).status, action === 'stop' ? 'stopping' : 'deleting');
      if (action === 'stop') {
        assert.equal(
          (await post({ schemaVersion: 1, expectedVersion: initial.version, action: 'delete' })).status,
          409,
        );
        assert.equal(actionCalls, 1, 'a stale version must not dispatch another action');
      }
      // Explicit barrier: neither 202 nor a running command proves completion.
      command = { ...command!, status: 'succeeded', completedAt: 2 };
      workspace = { ...workspace, version: workspace.version + 1, status: action === 'stop' ? 'stopped' : 'deleted' };
      assert.equal((await (await fetch(commandPath)).json()).data.status, 'succeeded');
      assert.equal((await readWorkspace()).status, action === 'stop' ? 'stopped' : 'deleted');
    }
    assert.equal(actionCalls, 2);
    return [{ name: 'workspace_cleanup_http_handoff', value: actionCalls, unit: 'settled actions' }];
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
};
