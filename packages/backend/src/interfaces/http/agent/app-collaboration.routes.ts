import { Buffer } from 'node:buffer';
import { Router, type Request } from 'express';
import type { AgentCollaborationFacade, AgentMemoryFacade } from '../../../modules/agent/public';
import type { MemoryStatus } from '../../../modules/agent/ai/memory.repository.port';
import { agentData, agentRoute } from './agent-http';
import { agentUserId, createAgentMutationSecurity, requireAgentAuthenticated } from './agent-security';

export interface AppCollaborationRouterDependencies {
  collaboration: AgentCollaborationFacade;
  memories: AgentMemoryFacade;
  nodeEnv: string;
  publicOrigin?: string;
}

const param = (value: string | string[] | undefined): string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) throw new Error('VALIDATION_FAILED');
  return value;
};

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED');
  return value as Record<string, unknown>;
};

const only = (value: Record<string, unknown>, keys: readonly string[]): void => {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
};

const positiveInteger = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error('VALIDATION_FAILED');
  return value as number;
};

const idempotencyKey = (request: Request): string => {
  const value = request.header('idempotency-key');
  if (!value) throw new Error('IDEMPOTENCY_KEY_INVALID');
  return value;
};

const queryString = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value || value.length > 512) throw new Error('VALIDATION_FAILED');
  return value;
};

const decodeCursor = (raw: string | undefined): { createdAt: number; id: string } | undefined => {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('CURSOR_INVALID');
    const value = parsed as Record<string, unknown>;
    if (
      !Number.isSafeInteger(value.createdAt) ||
      (value.createdAt as number) < 0 ||
      typeof value.id !== 'string' ||
      !value.id
    ) {
      throw new Error('CURSOR_INVALID');
    }
    return { createdAt: value.createdAt as number, id: value.id };
  } catch (error) {
    if (error instanceof Error && error.message === 'CURSOR_INVALID') throw error;
    throw new Error('CURSOR_INVALID');
  }
};

const encodeCursor = (value: { createdAt: number; id: string } | undefined): string | null =>
  value ? Buffer.from(JSON.stringify(value), 'utf8').toString('base64url') : null;

export const createAppCollaborationRouter = (dependencies: AppCollaborationRouterDependencies): Router => {
  const router = Router({ mergeParams: true });
  const mutationSecurity = createAgentMutationSecurity({
    nodeEnv: dependencies.nodeEnv,
    publicOrigin: dependencies.publicOrigin,
  });
  router.use(requireAgentAuthenticated);

  router.get(
    '/subagent-settings',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      agentData(request, response, await dependencies.collaboration.getSettings(scope));
    }),
  );

  router.patch(
    '/subagent-settings',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const body = record(request.body);
      only(body, ['expectedVersion', 'profiles']);
      const expectedVersion = Number(body.expectedVersion);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error('VALIDATION_FAILED');
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      agentData(
        request,
        response,
        await dependencies.collaboration.replaceProfiles(scope, { profiles: body.profiles }, expectedVersion),
      );
    }),
  );

  router.post(
    '/runs/:runId/subagents',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const body = record(request.body);
      only(body, [
        'parentRuntimeId',
        'profileId',
        'objective',
        'constraints',
        'inputArtifactRefs',
        'maxTokens',
        'maxSteps',
        'deadlineAt',
        'completionCriteria',
        'dependsOn',
        'dependencyMode',
      ]);
      const parentRuntimeId = param(body.parentRuntimeId as string | undefined);
      const { parentRuntimeId: _ignored, ...input } = body;
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      const runId = param(request.params.runId);
      const created = await dependencies.collaboration.createSubagent(
        scope,
        runId,
        parentRuntimeId,
        input,
        idempotencyKey(request),
      );
      response.setHeader(
        'Location',
        `/api/v1/apps/${encodeURIComponent(scope.appId)}/runs/${encodeURIComponent(runId)}/subagents/${encodeURIComponent(created.id)}`,
      );
      agentData(request, response, created, 201);
    }),
  );

  router.get(
    '/runs/:runId/subagents',
    agentRoute(async (request, response) => {
      const rawLimit = queryString(request.query.limit);
      const limit = rawLimit === undefined ? 50 : positiveInteger(Number(rawLimit));
      if (limit > 100) throw new Error('VALIDATION_FAILED');
      const parentRuntimeId = queryString(request.query.parentRuntimeId);
      const before = decodeCursor(queryString(request.query.before));
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      const items = await dependencies.collaboration.listSubagents(
        scope,
        param(request.params.runId),
        parentRuntimeId,
        limit + 1,
        before,
      );
      const hasMore = items.length > limit;
      const page = hasMore ? items.slice(0, limit) : items;
      const tail = hasMore ? page.at(-1) : undefined;
      agentData(request, response, {
        items: page,
        nextCursor: encodeCursor(tail ? { createdAt: tail.createdAt, id: tail.id } : undefined),
      });
    }),
  );

  router.post(
    '/runs/:runId/subagents/:delegationId/cancel',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const body = record(request.body);
      only(body, ['expectedVersion']);
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      const result = await dependencies.collaboration.cancelSubagent(
        scope,
        param(request.params.runId),
        param(request.params.delegationId),
        positiveInteger(body.expectedVersion),
      );
      agentData(request, response, result, 202);
    }),
  );

  router.get(
    '/runs/:runId/subagents/:delegationId/messages',
    agentRoute(async (request, response) => {
      const rawLimit = queryString(request.query.limit);
      const limit = rawLimit === undefined ? 50 : positiveInteger(Number(rawLimit));
      if (limit > 100) throw new Error('VALIDATION_FAILED');
      const before = decodeCursor(queryString(request.query.before));
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      const items = await dependencies.collaboration.listSubagentMessages(
        scope,
        param(request.params.runId),
        param(request.params.delegationId),
        limit + 1,
        before,
      );
      const hasMore = items.length > limit;
      const page = hasMore ? items.slice(0, limit) : items;
      const tail = hasMore ? page.at(-1) : undefined;
      agentData(request, response, {
        items: page,
        nextCursor: encodeCursor(tail ? { createdAt: tail.createdAt, id: tail.id } : undefined),
      });
    }),
  );

  router.get(
    '/memories',
    agentRoute(async (request, response) => {
      const status = queryString(request.query.status) ?? 'all';
      if (!['candidate', 'published', 'revoked', 'all'].includes(status)) throw new Error('VALIDATION_FAILED');
      const rawLimit = queryString(request.query.limit);
      const limit = rawLimit === undefined ? 100 : positiveInteger(Number(rawLimit));
      if (limit > 200) throw new Error('VALIDATION_FAILED');
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      agentData(request, response, await dependencies.memories.list(scope, status as MemoryStatus | 'all', limit));
    }),
  );

  router.post(
    '/memories/proposals',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      const created = await dependencies.memories.propose(scope, request.body);
      response.setHeader(
        'Location',
        `/api/v1/apps/${encodeURIComponent(scope.appId)}/memories/${encodeURIComponent(created.id)}`,
      );
      agentData(request, response, created, 201);
    }),
  );

  router.post(
    '/memories/:memoryId/review',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      agentData(
        request,
        response,
        await dependencies.memories.review(scope, param(request.params.memoryId), request.body),
      );
    }),
  );

  router.post(
    '/memories/imports/preview',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const body = record(request.body);
      only(body, ['sourceAppId', 'sourceMemoryId']);
      const sourceAppId = param(body.sourceAppId as string | undefined);
      const sourceMemoryId = param(body.sourceMemoryId as string | undefined);
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      agentData(request, response, await dependencies.memories.previewImport(scope, sourceAppId, sourceMemoryId), 201);
    }),
  );

  router.post(
    '/memories/imports/:confirmationId/confirm',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const body = record(request.body);
      if (Object.keys(body).length !== 0) throw new Error('VALIDATION_FAILED');
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      agentData(
        request,
        response,
        await dependencies.memories.confirmImport(scope, param(request.params.confirmationId)),
        201,
      );
    }),
  );

  return router;
};
