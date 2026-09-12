import { Router, type Request } from 'express';
import type { AgentApprovalFacade, AgentWorkspaceRuntimeFacade, AgentRunFacade } from '../../../modules/agent/public';
import { agentData, agentError, agentRequestId, agentRoute } from './agent-http';
import { pathParam, positiveInteger, withVersionConflictDetails } from './agent-route-input';
import { agentUserId, createAgentMutationSecurity, requireAgentAuthenticated } from './agent-security';
import {
  parseAppendInputRequest,
  parseBudgetIncreaseRequest,
  parseCreateRunRequest,
  parseExpectedVersionRequest,
  parseResumeRunRequest,
  parseSetGoalRequest,
  parseWorkspaceActionRequest,
  parseWorkspaceCreateRequest,
  parseWorkspaceToolVersionsRequest,
} from './agent-runtime-route-input';

export interface AppRuntimeRouterDependencies {
  runs: AgentRunFacade;
  approvals: AgentApprovalFacade;
  workspaceRuntime: AgentWorkspaceRuntimeFacade;
  nodeEnv: string;
  publicOrigin?: string;
  csrfSecret: string;
}

const queryString = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (Array.isArray(value) || typeof value !== 'string' || value.length === 0) throw new Error('VALIDATION_FAILED');
  return value;
};

const idempotencyKey = (request: Request): string => {
  const value = request.header('idempotency-key');
  if (!value) throw new Error('IDEMPOTENCY_KEY_INVALID');
  return value;
};

export const createAppRuntimeRouter = (dependencies: AppRuntimeRouterDependencies): Router => {
  const router = Router({ mergeParams: true });
  const mutationSecurity = createAgentMutationSecurity({
    nodeEnv: dependencies.nodeEnv,
    publicOrigin: dependencies.publicOrigin,
    csrfSecret: dependencies.csrfSecret,
  });

  router.use(requireAgentAuthenticated);

  router.get(
    '/agent-definitions',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(request, response, await dependencies.runs.definitions(scope));
    }),
  );

  router.get(
    '/runs',
    agentRoute(async (request, response) => {
      const rawLimit = queryString(request.query.limit);
      const limit = rawLimit === undefined ? 50 : Number(rawLimit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('VALIDATION_FAILED');
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(
        request,
        response,
        await dependencies.runs.list(
          scope,
          queryString(request.query.threadId),
          limit,
          queryString(request.query.before),
        ),
      );
    }),
  );

  router.post(
    '/runs',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const input = parseCreateRunRequest(request.body);
      const run = await dependencies.runs.create(scope, {
        ...input,
        command: { key: idempotencyKey(request), requestId: agentRequestId(request, response) },
      });
      response.setHeader('Location', `/api/v1/apps/${encodeURIComponent(scope.appId)}/runs/${run.id}`);
      agentData(request, response, run, 201);
    }),
  );

  router.get(
    '/runs/:runId',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(request, response, await dependencies.runs.get(scope, pathParam(request.params.runId)));
    }),
  );

  router.get(
    '/runs/:runId/approvals',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(request, response, await dependencies.approvals.list(scope, pathParam(request.params.runId)));
    }),
  );

  router.get(
    '/runs/:runId/checkpoints',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(request, response, await dependencies.runs.listCheckpoints(scope, pathParam(request.params.runId)));
    }),
  );

  router.get('/runs/:runId/events', (request, response) => {
    agentError(
      request,
      response,
      410,
      'AGENT_STREAM_PROTOCOL_REPLACED',
      'Agent Run event streaming moved to the /ws/agent WebSocket protocol.',
    );
  });

  router.post(
    '/runs/:runId/checkpoints',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const expectedVersion = parseExpectedVersionRequest(request.body);
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const runId = pathParam(request.params.runId);
      const checkpoint = await withVersionConflictDetails(
        expectedVersion,
        async () => (await dependencies.runs.get(scope, runId)).version,
        () => dependencies.runs.saveCheckpoint(scope, runId, expectedVersion),
      );
      response.setHeader(
        'Location',
        `/api/v1/apps/${encodeURIComponent(scope.appId)}/runs/${encodeURIComponent(checkpoint.runId)}`,
      );
      agentData(request, response, checkpoint, 201);
    }),
  );

  router.post(
    '/runs/:runId/resume',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = parseResumeRunRequest(request.body);
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const runId = pathParam(request.params.runId);
      const run = await withVersionConflictDetails(
        input.expectedVersion,
        async () => (await dependencies.runs.get(scope, runId)).version,
        () =>
          dependencies.runs.resume(scope, runId, input.checkpointId, input.expectedVersion, idempotencyKey(request)),
      );
      response.setHeader(
        'Location',
        `/api/v1/apps/${encodeURIComponent(scope.appId)}/runs/${encodeURIComponent(run.id)}`,
      );
      agentData(request, response, run, 201);
    }),
  );

  router.post(
    '/runs/:runId/inputs',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = parseAppendInputRequest(request.body);
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const runId = pathParam(request.params.runId);
      const result = await withVersionConflictDetails(
        input.expectedVersion,
        async () => (await dependencies.runs.get(scope, runId)).version,
        () => dependencies.runs.appendInput(scope, runId, input.input, input.expectedVersion, idempotencyKey(request)),
      );
      agentData(request, response, result, 202);
    }),
  );

  router.post(
    '/runs/:runId/interrupt',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = parseAppendInputRequest(request.body);
      if (input.input.artifactRefs.length > 0) throw new Error('VALIDATION_FAILED');
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const runId = pathParam(request.params.runId);
      const result = await withVersionConflictDetails(
        input.expectedVersion,
        async () => (await dependencies.runs.get(scope, runId)).version,
        () => dependencies.runs.interrupt(scope, runId, input.input, input.expectedVersion, idempotencyKey(request)),
      );
      agentData(request, response, result, 202);
    }),
  );

  router.get(
    '/runs/:runId/pending-inputs',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(request, response, await dependencies.runs.pendingInputs(scope, pathParam(request.params.runId)));
    }),
  );

  router.post(
    '/runs/:runId/goal',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = parseSetGoalRequest(request.body);
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const runId = pathParam(request.params.runId);
      const run = await withVersionConflictDetails(
        input.expectedVersion,
        async () => (await dependencies.runs.get(scope, runId)).version,
        () => dependencies.runs.setGoal(scope, runId, input.text, input.expectedVersion, idempotencyKey(request)),
      );
      agentData(request, response, run);
    }),
  );

  router.post(
    '/runs/:runId/budget',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const { increase, expectedVersion } = parseBudgetIncreaseRequest(request.body);
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const runId = pathParam(request.params.runId);
      const run = await withVersionConflictDetails(
        expectedVersion,
        async () => (await dependencies.runs.get(scope, runId)).version,
        () => dependencies.runs.increaseBudget(scope, runId, increase, expectedVersion, idempotencyKey(request)),
      );
      agentData(request, response, run);
    }),
  );

  router.post(
    '/runs/:runId/cancel',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const expectedVersion = parseExpectedVersionRequest(request.body);
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const runId = pathParam(request.params.runId);
      const run = await withVersionConflictDetails(
        expectedVersion,
        async () => (await dependencies.runs.get(scope, runId)).version,
        () => dependencies.runs.cancel(scope, runId, expectedVersion, idempotencyKey(request)),
      );
      agentData(request, response, run, run.status === 'cancelled' ? 200 : 202);
    }),
  );

  router.delete(
    '/runs/:runId',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const rawVersion = queryString(request.query.expectedVersion);
      const expectedVersion = rawVersion === undefined ? Number.NaN : Number(rawVersion);
      if (!positiveInteger(expectedVersion)) throw new Error('VALIDATION_FAILED');
      const runId = pathParam(request.params.runId);
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      await withVersionConflictDetails(
        expectedVersion,
        async () => (await dependencies.runs.get(scope, runId)).version,
        () => dependencies.runs.delete(scope, runId, expectedVersion, idempotencyKey(request)),
      );
      agentData(request, response, { runId, deleted: true }, 202);
    }),
  );

  router.get(
    '/runs/:runId/workspaces',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const runId = pathParam(request.params.runId);
      const runtime = queryString(request.query.runtime);
      if (runtime !== undefined && runtime !== 'root') throw new Error('VALIDATION_FAILED');
      const workspaces = await dependencies.workspaceRuntime.listWorkspaces(scope, runId);
      if (runtime !== 'root') {
        agentData(request, response, workspaces);
        return;
      }
      const rootRuntimeId = await dependencies.runs.rootRuntimeId(scope, runId);
      agentData(
        request,
        response,
        workspaces.filter((workspace) => workspace.agentRuntimeId === rootRuntimeId),
      );
    }),
  );

  router.post(
    '/runs/:runId/workspaces',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = parseWorkspaceCreateRequest(request.body);
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const runId = pathParam(request.params.runId);
      const agentRuntimeId = await dependencies.runs.rootRuntimeId(scope, runId);
      const workspace = await dependencies.workspaceRuntime.createWorkspace(
        scope,
        runId,
        agentRuntimeId,
        input.workspace,
        input.retained,
        idempotencyKey(request),
        input.catalogRevision,
      );
      response.setHeader('Location', `/api/v1/apps/${encodeURIComponent(scope.appId)}/workspaces/${workspace.id}`);
      agentData(request, response, workspace, 202);
    }),
  );

  router.get(
    '/workspaces/:workspaceId',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(
        request,
        response,
        await dependencies.workspaceRuntime.getWorkspace(scope, pathParam(request.params.workspaceId)),
      );
    }),
  );

  router.post(
    '/workspaces/:workspaceId/actions',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = parseWorkspaceActionRequest(request.body);
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const workspaceId = pathParam(request.params.workspaceId);
      const command = await withVersionConflictDetails(
        input.expectedVersion,
        async () => (await dependencies.workspaceRuntime.getWorkspace(scope, workspaceId)).version,
        () => dependencies.workspaceRuntime.action(scope, workspaceId, input.action, input.expectedVersion),
      );
      agentData(request, response, command, 202);
    }),
  );

  router.post(
    '/workspaces/:workspaceId/tool-versions',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = parseWorkspaceToolVersionsRequest(request.body);
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const workspaceId = pathParam(request.params.workspaceId);
      const switched = await withVersionConflictDetails(
        input.expectedVersion,
        async () => (await dependencies.workspaceRuntime.getWorkspace(scope, workspaceId)).version,
        () =>
          dependencies.workspaceRuntime.switchToolVersions(
            scope,
            workspaceId,
            input.versions,
            input.expectedVersion,
            input.catalogRevision,
          ),
      );
      agentData(request, response, switched, 202);
    }),
  );

  return router;
};
