import { Router, type Request } from 'express';
import type { AgentApprovalFacade, AgentWorkspaceRuntimeFacade, AgentRunFacade } from '../../../modules/agent/public';
import type { AgentWorkspaceCreateSpec } from '../../../modules/agent/workspace-runtime/workspace-runtime.types';
import type { JsonValue } from '../../../modules/agent/agent.types';
import type { CreateRunCommand, RunBudgetIncrease, UserInputData } from '../../../modules/agent/runtime/runs/run.types';
import { agentData, agentRequestId, agentRoute } from './agent-http';
import { agentUserId, createAgentMutationSecurity, requireAgentAuthenticated } from './agent-security';

export interface AppRuntimeRouterDependencies {
  runs: AgentRunFacade;
  approvals: AgentApprovalFacade;
  workspaceRuntime: AgentWorkspaceRuntimeFacade;
  nodeEnv: string;
  publicOrigin?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
};

const pathParam = (value: string | string[] | undefined): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error('VALIDATION_FAILED');
  return value;
};

const queryString = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (Array.isArray(value) || typeof value !== 'string' || value.length === 0) throw new Error('VALIDATION_FAILED');
  return value;
};

const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

const idempotencyKey = (request: Request): string => {
  const value = request.header('idempotency-key');
  if (!value) throw new Error('IDEMPOTENCY_KEY_INVALID');
  return value;
};

const parseUserInput = (value: unknown): UserInputData => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['text', 'artifactRefs'])) throw new Error('VALIDATION_FAILED');
  if (typeof value.text !== 'string' || !Array.isArray(value.artifactRefs)) throw new Error('VALIDATION_FAILED');
  if (value.artifactRefs.some((item) => typeof item !== 'string')) throw new Error('VALIDATION_FAILED');
  return { text: value.text, artifactRefs: value.artifactRefs as string[] };
};

const parseCreateCommand = (request: Request, requestId: string): CreateRunCommand => {
  if (
    !isRecord(request.body) ||
    !hasOnlyKeys(request.body, ['threadId', 'input', 'agentDefinitionId', 'model', 'connectionIds'])
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  const model = request.body.model;
  if (!isRecord(model) || !hasOnlyKeys(model, ['providerId', 'modelId', 'configurationVersion'])) {
    throw new Error('VALIDATION_FAILED');
  }
  if (
    typeof request.body.threadId !== 'string' ||
    typeof request.body.agentDefinitionId !== 'string' ||
    typeof model.providerId !== 'string' ||
    typeof model.modelId !== 'string' ||
    !positiveInteger(model.configurationVersion) ||
    !Array.isArray(request.body.connectionIds) ||
    request.body.connectionIds.some((value) => !positiveInteger(value))
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    threadId: request.body.threadId,
    input: parseUserInput(request.body.input),
    agentDefinitionId: request.body.agentDefinitionId,
    model: {
      providerId: model.providerId,
      modelId: model.modelId,
      configurationVersion: model.configurationVersion,
    },
    connectionIds: request.body.connectionIds as number[],
    command: { key: idempotencyKey(request), requestId },
  };
};

const parseBudgetIncrease = (body: unknown): { increase: RunBudgetIncrease; expectedVersion: number } => {
  if (!isRecord(body) || !hasOnlyKeys(body, ['scope', 'refId', 'increase', 'expectedVersion'])) {
    throw new Error('VALIDATION_FAILED');
  }
  if ((body.scope !== undefined && body.scope !== 'run') || body.refId !== undefined) {
    throw new Error('CAPABILITY_UNAVAILABLE');
  }
  if (!isRecord(body.increase) || !positiveInteger(body.expectedVersion)) throw new Error('VALIDATION_FAILED');
  if (!hasOnlyKeys(body.increase, ['maxRunTokens', 'maxRunSteps', 'maxActiveExecutionSeconds', 'maxCostMicros'])) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    increase: body.increase as RunBudgetIncrease,
    expectedVersion: body.expectedVersion,
  };
};

const parseWorkspaceSpec = (value: unknown): AgentWorkspaceCreateSpec => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['recipeId', 'versions', 'runnerPluginIds', 'limits', 'network'])) {
    throw new Error('VALIDATION_FAILED');
  }
  if (typeof value.recipeId !== 'string' || value.recipeId.length < 1 || value.recipeId.length > 128) {
    throw new Error('VALIDATION_FAILED');
  }
  if (value.versions !== undefined) {
    if (!isRecord(value.versions) || Object.keys(value.versions).length > 32) throw new Error('VALIDATION_FAILED');
    if (Object.entries(value.versions).some(([key, entry]) => !key || typeof entry !== 'string' || !entry)) {
      throw new Error('VALIDATION_FAILED');
    }
  }
  if (value.runnerPluginIds !== undefined) {
    if (
      !Array.isArray(value.runnerPluginIds) ||
      value.runnerPluginIds.length > 32 ||
      new Set(value.runnerPluginIds).size !== value.runnerPluginIds.length ||
      value.runnerPluginIds.some(
        (pluginId) => typeof pluginId !== 'string' || !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/.test(pluginId),
      )
    ) {
      throw new Error('VALIDATION_FAILED');
    }
  }
  if (value.limits !== undefined) {
    if (!isRecord(value.limits) || !hasOnlyKeys(value.limits, ['cpus', 'memoryBytes', 'pids', 'tmpfsBytes'])) {
      throw new Error('VALIDATION_FAILED');
    }
  }
  if (value.network !== undefined) {
    if (!isRecord(value.network) || !hasOnlyKeys(value.network, ['mode', 'hosts']))
      throw new Error('VALIDATION_FAILED');
    if ((value.network.mode !== 'none' && value.network.mode !== 'allowlist') || !Array.isArray(value.network.hosts)) {
      throw new Error('VALIDATION_FAILED');
    }
    if (value.network.hosts.some((host) => typeof host !== 'string')) throw new Error('VALIDATION_FAILED');
  }
  return value as unknown as AgentWorkspaceCreateSpec;
};

export const createAppRuntimeRouter = (dependencies: AppRuntimeRouterDependencies): Router => {
  const router = Router({ mergeParams: true });
  const mutationSecurity = createAgentMutationSecurity({
    nodeEnv: dependencies.nodeEnv,
    publicOrigin: dependencies.publicOrigin,
  });

  router.use(requireAgentAuthenticated);

  router.get(
    '/agent-definitions',
    agentRoute(async (request, response) => {
      agentData(request, response, dependencies.runs.definitions(pathParam(request.params.appId)));
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
      const command = parseCreateCommand(request, agentRequestId(request, response));
      const run = await dependencies.runs.create(scope, command);
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

  router.post(
    '/runs/:runId/checkpoints',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['expectedVersion']) ||
        !positiveInteger(request.body.expectedVersion)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const checkpoint = await dependencies.runs.saveCheckpoint(
        scope,
        pathParam(request.params.runId),
        request.body.expectedVersion,
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
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['checkpointId', 'expectedVersion']) ||
        typeof request.body.checkpointId !== 'string' ||
        request.body.checkpointId.length < 1 ||
        !positiveInteger(request.body.expectedVersion)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const run = await dependencies.runs.resume(
        scope,
        pathParam(request.params.runId),
        request.body.checkpointId,
        request.body.expectedVersion,
        idempotencyKey(request),
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
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['text', 'artifactRefs', 'expectedVersion'])) {
        throw new Error('VALIDATION_FAILED');
      }
      if (!positiveInteger(request.body.expectedVersion)) throw new Error('VALIDATION_FAILED');
      const input = parseUserInput({ text: request.body.text, artifactRefs: request.body.artifactRefs });
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(
        request,
        response,
        await dependencies.runs.appendInput(
          scope,
          pathParam(request.params.runId),
          input,
          request.body.expectedVersion,
          idempotencyKey(request),
        ),
        202,
      );
    }),
  );

  router.post(
    '/runs/:runId/budget',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const { increase, expectedVersion } = parseBudgetIncrease(request.body);
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(
        request,
        response,
        await dependencies.runs.increaseBudget(
          scope,
          pathParam(request.params.runId),
          increase,
          expectedVersion,
          idempotencyKey(request),
        ),
      );
    }),
  );

  router.post(
    '/runs/:runId/cancel',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['expectedVersion']) ||
        !positiveInteger(request.body.expectedVersion)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const run = await dependencies.runs.cancel(
        scope,
        pathParam(request.params.runId),
        request.body.expectedVersion,
        idempotencyKey(request),
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
      await dependencies.runs.delete(scope, runId, expectedVersion, idempotencyKey(request));
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
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['workspace', 'retained', 'catalogRevision']) ||
        (request.body.retained !== undefined && typeof request.body.retained !== 'boolean') ||
        (request.body.catalogRevision !== undefined &&
          (typeof request.body.catalogRevision !== 'string' ||
            !request.body.catalogRevision ||
            request.body.catalogRevision.length > 128))
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const runId = pathParam(request.params.runId);
      const agentRuntimeId = await dependencies.runs.rootRuntimeId(scope, runId);
      const workspace = await dependencies.workspaceRuntime.createWorkspace(
        scope,
        runId,
        agentRuntimeId,
        parseWorkspaceSpec(request.body.workspace),
        request.body.retained === true,
        idempotencyKey(request),
        request.body.catalogRevision as string | undefined,
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
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['action', 'expectedVersion', 'parameters']) ||
        !['start', 'stop', 'restart', 'delete', 'setNetwork', 'resize'].includes(String(request.body.action)) ||
        !positiveInteger(request.body.expectedVersion)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const parameters = request.body.parameters === undefined ? {} : (request.body.parameters as JsonValue);
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(
        request,
        response,
        await dependencies.workspaceRuntime.action(
          scope,
          pathParam(request.params.workspaceId),
          request.body.action as 'start' | 'stop' | 'restart' | 'delete' | 'setNetwork' | 'resize',
          request.body.expectedVersion,
          parameters,
        ),
        202,
      );
    }),
  );

  router.post(
    '/workspaces/:workspaceId/tool-versions',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['versions', 'expectedVersion', 'catalogRevision']) ||
        !isRecord(request.body.versions) ||
        Object.keys(request.body.versions).length < 1 ||
        Object.keys(request.body.versions).length > 32 ||
        Object.entries(request.body.versions).some(
          ([familyId, versionId]) =>
            !familyId || familyId.length > 128 || typeof versionId !== 'string' || !versionId || versionId.length > 128,
        ) ||
        !positiveInteger(request.body.expectedVersion) ||
        (request.body.catalogRevision !== undefined &&
          (typeof request.body.catalogRevision !== 'string' ||
            !request.body.catalogRevision ||
            request.body.catalogRevision.length > 128))
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(
        request,
        response,
        await dependencies.workspaceRuntime.switchToolVersions(
          scope,
          pathParam(request.params.workspaceId),
          request.body.versions as Record<string, string>,
          request.body.expectedVersion,
          request.body.catalogRevision as string | undefined,
        ),
        202,
      );
    }),
  );

  return router;
};
