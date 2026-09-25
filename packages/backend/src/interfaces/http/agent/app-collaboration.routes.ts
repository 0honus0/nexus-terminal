import type {
  AgentSubagentCancelRequestDto,
  AgentSubagentCreateRequestDto,
  AgentSubagentListQueryDto,
  AgentSubagentMessageListQueryDto,
  AgentSubagentProfileDto,
  AgentSubagentSettingsReplaceRequestDto,
} from '@nexus-terminal/protocol/agent-collaboration';
import type {
  AgentMemoryImportConfirmRequestDto,
  AgentMemoryImportPreviewRequestDto,
  AgentMemoryListQueryDto,
  AgentMemoryProposalRequestDto,
  AgentMemoryReviewRequestDto,
} from '@nexus-terminal/protocol/agent-memories';
import { Buffer } from 'node:buffer';
import { Router, type Request } from 'express';
import {
  AGENT_CAPABILITIES,
  type AgentCollaborationFacade,
  type AgentMemoryFacade,
} from '../../../modules/agent/public';
import { agentData, agentRoute } from './agent-http';
import { subagentDto, subagentMessageDto, subagentSettingsDto } from './collaboration-dto';
import { isJsonValue } from './agent-route-input';
import { memoryDto, memoryImportConfirmationDto } from './memory-dto';
import { agentUserId, createAgentMutationSecurity, requireAgentAuthenticated } from './agent-security';

export interface AppCollaborationRouterDependencies {
  collaboration: AgentCollaborationFacade;
  memories: AgentMemoryFacade;
  nodeEnv: string;
  publicOrigin?: string;
  csrfSecret: string;
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

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const capabilitySet = new Set<string>(AGENT_CAPABILITIES);

const modelRef = (value: unknown): AgentSubagentProfileDto['allowedModels'][number] => {
  const body = record(value);
  only(body, ['providerId', 'modelId', 'configurationVersion']);
  if (
    !nonEmpty(body.providerId) ||
    !nonEmpty(body.modelId) ||
    !Number.isSafeInteger(body.configurationVersion) ||
    Number(body.configurationVersion) < 1
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    providerId: body.providerId.trim(),
    modelId: body.modelId.trim(),
    configurationVersion: Number(body.configurationVersion),
  };
};

const profileDtoInput = (value: unknown): AgentSubagentProfileDto => {
  const body = record(value);
  only(body, [
    'id',
    'role',
    'defaultModel',
    'allowedModels',
    'capabilities',
    'peerMessaging',
    'mutationMode',
    'maxSteps',
    'failureMode',
  ]);
  if (
    !nonEmpty(body.id) ||
    !nonEmpty(body.role) ||
    !Array.isArray(body.allowedModels) ||
    body.allowedModels.length < 1
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  const allowedModels = body.allowedModels.map(modelRef);
  const defaultModel = body.defaultModel === null ? null : modelRef(body.defaultModel);
  if (
    !Array.isArray(body.capabilities) ||
    body.capabilities.some((capability) => typeof capability !== 'string' || !capabilitySet.has(capability)) ||
    (body.peerMessaging !== 'parent-child' && body.peerMessaging !== 'same-run') ||
    (body.mutationMode !== 'read-only' && body.mutationMode !== 'governed') ||
    !Number.isSafeInteger(body.maxSteps) ||
    Number(body.maxSteps) < 1 ||
    (body.failureMode !== 'isolate' && body.failureMode !== 'failFast')
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    id: body.id.trim(),
    role: body.role.trim(),
    defaultModel,
    allowedModels,
    capabilities: [...new Set(body.capabilities)] as AgentSubagentProfileDto['capabilities'],
    peerMessaging: body.peerMessaging,
    mutationMode: body.mutationMode,
    maxSteps: Number(body.maxSteps),
    failureMode: body.failureMode,
  };
};

const settingsReplaceRequest = (value: unknown): AgentSubagentSettingsReplaceRequestDto => {
  const body = record(value);
  only(body, ['expectedVersion', 'profiles']);
  if (
    !Number.isSafeInteger(body.expectedVersion) ||
    Number(body.expectedVersion) < 0 ||
    !Array.isArray(body.profiles)
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return { profiles: body.profiles.map(profileDtoInput), expectedVersion: Number(body.expectedVersion) };
};

const stringArray = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.some((entry) => !nonEmpty(entry))) throw new Error('VALIDATION_FAILED');
  return value.map((entry) => (entry as string).trim());
};

const subagentCreateRequest = (value: unknown): AgentSubagentCreateRequestDto => {
  const body = record(value);
  only(body, [
    'parentRuntimeId',
    'profileId',
    'objective',
    'constraints',
    'inputArtifactRefs',
    'maxSteps',
    'deadlineAt',
    'completionCriteria',
    'dependsOn',
    'dependencyMode',
  ]);
  if (
    !nonEmpty(body.parentRuntimeId) ||
    !nonEmpty(body.profileId) ||
    !nonEmpty(body.objective) ||
    !Number.isSafeInteger(body.maxSteps) ||
    Number(body.maxSteps) < 1 ||
    !Number.isSafeInteger(body.deadlineAt) ||
    (body.dependencyMode !== 'success' && body.dependencyMode !== 'settled')
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    parentRuntimeId: body.parentRuntimeId,
    profileId: body.profileId,
    objective: body.objective,
    constraints: stringArray(body.constraints),
    inputArtifactRefs: stringArray(body.inputArtifactRefs),
    maxSteps: Number(body.maxSteps),
    deadlineAt: Number(body.deadlineAt),
    completionCriteria: stringArray(body.completionCriteria),
    dependsOn: stringArray(body.dependsOn),
    dependencyMode: body.dependencyMode,
  };
};

const memoryProposalRequest = (value: unknown): AgentMemoryProposalRequestDto => {
  const body = record(value);
  only(body, ['content', 'sourceRefs', 'confidence', 'expiresAt']);
  if (
    !nonEmpty(body.content) ||
    !isJsonValue(body.sourceRefs) ||
    typeof body.confidence !== 'number' ||
    !Number.isFinite(body.confidence) ||
    (body.expiresAt !== null && !Number.isSafeInteger(body.expiresAt))
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    content: body.content,
    sourceRefs: body.sourceRefs,
    confidence: body.confidence,
    expiresAt: body.expiresAt as number | null,
  };
};

const memoryReviewRequest = (value: unknown): AgentMemoryReviewRequestDto => {
  const body = record(value);
  only(body, ['decision', 'expectedVersion', 'content']);
  if (
    !['publish', 'reject', 'revoke'].includes(String(body.decision)) ||
    !Number.isSafeInteger(body.expectedVersion) ||
    Number(body.expectedVersion) < 1 ||
    (body.content !== undefined && !nonEmpty(body.content))
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    decision: body.decision as AgentMemoryReviewRequestDto['decision'],
    expectedVersion: Number(body.expectedVersion),
    ...(body.content === undefined ? {} : { content: body.content as string }),
  };
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
    csrfSecret: dependencies.csrfSecret,
  });
  router.use(requireAgentAuthenticated);

  router.get(
    '/subagent-settings',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      agentData(request, response, subagentSettingsDto(await dependencies.collaboration.getSettings(scope)));
    }),
  );

  router.patch(
    '/subagent-settings',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = settingsReplaceRequest(request.body);
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      agentData(
        request,
        response,
        subagentSettingsDto(
          await dependencies.collaboration.replaceProfiles(scope, { profiles: input.profiles }, input.expectedVersion),
        ),
      );
    }),
  );

  router.post(
    '/runs/:runId/subagents',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = subagentCreateRequest(request.body);
      const { parentRuntimeId, ...delegationInput } = input;
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      const runId = param(request.params.runId);
      const created = await dependencies.collaboration.createSubagent(
        scope,
        runId,
        parentRuntimeId,
        delegationInput,
        idempotencyKey(request),
      );
      response.setHeader(
        'Location',
        `/api/v1/apps/${encodeURIComponent(scope.appId)}/runs/${encodeURIComponent(runId)}/subagents/${encodeURIComponent(created.id)}`,
      );
      agentData(request, response, subagentDto(created), 201);
    }),
  );

  router.get(
    '/runs/:runId/subagents',
    agentRoute(async (request, response) => {
      const rawLimit = queryString(request.query.limit);
      const limit = rawLimit === undefined ? 50 : positiveInteger(Number(rawLimit));
      if (limit > 100) throw new Error('VALIDATION_FAILED');
      const parentRuntimeId = queryString(request.query.parentRuntimeId);
      const beforeRaw = queryString(request.query.before);
      const query: AgentSubagentListQueryDto = {
        limit,
        ...(parentRuntimeId === undefined ? {} : { parentRuntimeId }),
        ...(beforeRaw === undefined ? {} : { before: beforeRaw }),
      };
      const before = decodeCursor(query.before);
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      const items = await dependencies.collaboration.listSubagents(
        scope,
        param(request.params.runId),
        query.parentRuntimeId,
        query.limit + 1,
        before,
      );
      const hasMore = items.length > query.limit;
      const page = hasMore ? items.slice(0, query.limit) : items;
      const tail = hasMore ? page.at(-1) : undefined;
      agentData(request, response, {
        items: page.map(subagentDto),
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
      const input: AgentSubagentCancelRequestDto = { expectedVersion: positiveInteger(body.expectedVersion) };
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      const result = await dependencies.collaboration.cancelSubagent(
        scope,
        param(request.params.runId),
        param(request.params.delegationId),
        input.expectedVersion,
      );
      agentData(request, response, subagentDto(result), 202);
    }),
  );

  router.get(
    '/runs/:runId/subagents/:delegationId/messages',
    agentRoute(async (request, response) => {
      const rawLimit = queryString(request.query.limit);
      const limit = rawLimit === undefined ? 50 : positiveInteger(Number(rawLimit));
      if (limit > 100) throw new Error('VALIDATION_FAILED');
      const beforeRaw = queryString(request.query.before);
      const query: AgentSubagentMessageListQueryDto = {
        limit,
        ...(beforeRaw === undefined ? {} : { before: beforeRaw }),
      };
      const before = decodeCursor(query.before);
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      const items = await dependencies.collaboration.listSubagentMessages(
        scope,
        param(request.params.runId),
        param(request.params.delegationId),
        query.limit + 1,
        before,
      );
      const hasMore = items.length > query.limit;
      const page = hasMore ? items.slice(0, query.limit) : items;
      const tail = hasMore ? page.at(-1) : undefined;
      agentData(request, response, {
        items: page.map(subagentMessageDto),
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
      const query: AgentMemoryListQueryDto = {
        status: status as AgentMemoryListQueryDto['status'],
        limit,
      };
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      agentData(request, response, (await dependencies.memories.list(scope, query.status, query.limit)).map(memoryDto));
    }),
  );

  router.post(
    '/memories/proposals',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = memoryProposalRequest(request.body);
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      const created = await dependencies.memories.propose(scope, input);
      response.setHeader(
        'Location',
        `/api/v1/apps/${encodeURIComponent(scope.appId)}/memories/${encodeURIComponent(created.id)}`,
      );
      agentData(request, response, memoryDto(created), 201);
    }),
  );

  router.post(
    '/memories/:memoryId/review',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = memoryReviewRequest(request.body);
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      agentData(
        request,
        response,
        memoryDto(await dependencies.memories.review(scope, param(request.params.memoryId), input)),
      );
    }),
  );

  router.post(
    '/memories/imports/preview',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const body = record(request.body);
      only(body, ['sourceAppId', 'sourceMemoryId']);
      const input: AgentMemoryImportPreviewRequestDto = {
        sourceAppId: param(body.sourceAppId as string | undefined),
        sourceMemoryId: param(body.sourceMemoryId as string | undefined),
      };
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      agentData(
        request,
        response,
        memoryImportConfirmationDto(
          await dependencies.memories.previewImport(scope, input.sourceAppId, input.sourceMemoryId),
        ),
        201,
      );
    }),
  );

  router.post(
    '/memories/imports/:confirmationId/confirm',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const body = record(request.body);
      if (Object.keys(body).length !== 0) throw new Error('VALIDATION_FAILED');
      const input: AgentMemoryImportConfirmRequestDto = {};
      void input;
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      agentData(
        request,
        response,
        memoryDto(await dependencies.memories.confirmImport(scope, param(request.params.confirmationId))),
        201,
      );
    }),
  );

  return router;
};
