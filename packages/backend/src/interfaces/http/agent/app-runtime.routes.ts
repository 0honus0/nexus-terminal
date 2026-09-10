import { Router, type Request } from 'express';
import type {
  AgentApprovalFacade,
  AgentEnvironmentFacade,
  AgentEventFacade,
  AgentRunFacade,
} from '../../../modules/agent/public';
import type { EnvironmentCreateSpec } from '../../../modules/agent/environments/environment.types';
import type { JsonValue } from '../../../modules/agent/agent.types';
import type { CreateRunCommand, RunBudgetIncrease, UserInputData } from '../../../modules/agent/runtime/runs/run.types';
import { agentData, agentRequestId, agentRoute } from './agent-http';
import { agentUserId, createAgentMutationSecurity, requireAgentAuthenticated } from './agent-security';
import {
  acquireAgentSseSlot,
  AgentSseWriter,
  initializeSseResponse,
  reloadAgentSession,
  resolveSseCursor,
  waitForSseWake,
} from './agent-sse';

export interface AppRuntimeRouterDependencies {
  runs: AgentRunFacade;
  events: AgentEventFacade;
  approvals: AgentApprovalFacade;
  environments: AgentEnvironmentFacade;
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

const parseEnvironmentSpecs = (value: unknown): EnvironmentCreateSpec[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new Error('VALIDATION_FAILED');
  return value.map((item) => {
    if (!isRecord(item) || !hasOnlyKeys(item, ['recipeId', 'versions', 'runnerPluginIds', 'limits', 'network'])) {
      throw new Error('VALIDATION_FAILED');
    }
    if (typeof item.recipeId !== 'string' || item.recipeId.length < 1 || item.recipeId.length > 128) {
      throw new Error('VALIDATION_FAILED');
    }
    if (item.versions !== undefined) {
      if (!isRecord(item.versions) || Object.keys(item.versions).length > 32) throw new Error('VALIDATION_FAILED');
      if (Object.entries(item.versions).some(([key, entry]) => !key || typeof entry !== 'string' || !entry)) {
        throw new Error('VALIDATION_FAILED');
      }
    }
    if (item.runnerPluginIds !== undefined) {
      if (
        !Array.isArray(item.runnerPluginIds) ||
        item.runnerPluginIds.length > 32 ||
        new Set(item.runnerPluginIds).size !== item.runnerPluginIds.length ||
        item.runnerPluginIds.some(
          (pluginId) => typeof pluginId !== 'string' || !/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/.test(pluginId),
        )
      ) {
        throw new Error('VALIDATION_FAILED');
      }
    }
    if (item.limits !== undefined) {
      if (!isRecord(item.limits) || !hasOnlyKeys(item.limits, ['cpus', 'memoryBytes', 'pids', 'tmpfsBytes'])) {
        throw new Error('VALIDATION_FAILED');
      }
    }
    if (item.network !== undefined) {
      if (!isRecord(item.network) || !hasOnlyKeys(item.network, ['mode', 'hosts']))
        throw new Error('VALIDATION_FAILED');
      if ((item.network.mode !== 'none' && item.network.mode !== 'allowlist') || !Array.isArray(item.network.hosts)) {
        throw new Error('VALIDATION_FAILED');
      }
      if (item.network.hosts.some((host) => typeof host !== 'string')) throw new Error('VALIDATION_FAILED');
    }
    return item as unknown as EnvironmentCreateSpec;
  });
};

const runFrame = (runId: string, event: Awaited<ReturnType<AgentEventFacade['readRun']>>[number]): string =>
  `id: ${runId}:${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify({
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    payload: event.payload,
  })}\n\n`;

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
    '/runs/:runId/environment-groups',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const runId = pathParam(request.params.runId);
      const runtime = queryString(request.query.runtime);
      if (runtime !== undefined && runtime !== 'root') throw new Error('VALIDATION_FAILED');
      const groups = await dependencies.environments.listGroups(scope, runId);
      if (runtime !== 'root') {
        agentData(request, response, groups);
        return;
      }
      const rootRuntimeId = await dependencies.runs.rootRuntimeId(scope, runId);
      agentData(
        request,
        response,
        groups.filter((group) => group.agentRuntimeId === rootRuntimeId),
      );
    }),
  );

  router.post(
    '/runs/:runId/environment-groups',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['environments', 'retained']) ||
        (request.body.retained !== undefined && typeof request.body.retained !== 'boolean')
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const runId = pathParam(request.params.runId);
      const agentRuntimeId = await dependencies.runs.rootRuntimeId(scope, runId);
      const group = await dependencies.environments.createGroup(
        scope,
        runId,
        agentRuntimeId,
        parseEnvironmentSpecs(request.body.environments),
        request.body.retained === true,
        idempotencyKey(request),
      );
      response.setHeader('Location', `/api/v1/apps/${encodeURIComponent(scope.appId)}/environment-groups/${group.id}`);
      agentData(request, response, group, 202);
    }),
  );

  router.get(
    '/environment-groups/:groupId',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(request, response, await dependencies.environments.getGroup(scope, pathParam(request.params.groupId)));
    }),
  );

  router.post(
    '/environments/:environmentId/actions',
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
        await dependencies.environments.action(
          scope,
          pathParam(request.params.environmentId),
          request.body.action as 'start' | 'stop' | 'restart' | 'delete' | 'setNetwork' | 'resize',
          request.body.expectedVersion,
          parameters,
        ),
        202,
      );
    }),
  );

  router.get(
    '/runs/:runId/events',
    agentRoute(async (request, response) => {
      const userId = agentUserId(request);
      const appId = pathParam(request.params.appId);
      const runId = pathParam(request.params.runId);
      const scope = { userId, appId };
      const snapshot = await dependencies.runs.get(scope, runId);
      let cursor = resolveSseCursor(request, `${runId}:`, snapshot.eventCursor);
      const releaseSlot = acquireAgentSseSlot(request);
      initializeSseResponse(response);
      const writer = new AgentSseWriter(response);
      const unsubscribeTransient = dependencies.events.onTransient(runId, (event) => {
        writer.enqueue(
          `event: ${event.type}\ndata: ${JSON.stringify({ occurredAt: event.occurredAt, payload: event.payload })}\n\n`,
        );
      });
      const startedAt = Date.now();
      let lastHeartbeatAt = startedAt;
      let lastAuthCheckAt = startedAt;
      try {
        while (!writer.closed && Date.now() - startedAt < 10 * 60 * 1000) {
          const page = await dependencies.events.readRun(scope, runId, cursor, 100);
          if (page.length > 0) {
            for (const event of page) {
              if (!writer.enqueue(runFrame(runId, event))) break;
              cursor = event.sequence;
            }
            if (page.length === 100) continue;
          }
          const now = Date.now();
          if (now - lastHeartbeatAt >= 15_000) {
            writer.heartbeat();
            lastHeartbeatAt = now;
          }
          if (now - lastAuthCheckAt >= 5_000) {
            if (!(await reloadAgentSession(request, userId))) {
              writer.close(true);
              break;
            }
            lastAuthCheckAt = now;
          }
          await waitForSseWake((wake) => dependencies.events.onRunWake(runId, wake));
        }
      } finally {
        unsubscribeTransient();
        releaseSlot();
        writer.close(true);
      }
    }),
  );

  return router;
};
