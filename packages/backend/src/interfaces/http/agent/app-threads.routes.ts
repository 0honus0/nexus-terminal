import type {
  AgentLedgerEntryDto,
  AgentLedgerPageDto,
  AgentLedgerQueryDto,
  AgentThreadCreateRequestDto,
  AgentThreadDeleteAllRequestDto,
  AgentThreadDeleteAllResultDto,
  AgentThreadDeleteRequestDto,
  AgentThreadDeleteResultDto,
  AgentThreadListQueryDto,
  AgentThreadPageDto,
  AgentThreadRenameRequestDto,
  AgentThreadViewDto,
} from '@nexus-terminal/protocol/agent-threads';
import { Router, type Request } from 'express';
import type { AgentConversationFacade } from '../../../modules/agent/public';
import { agentData, agentRoute } from './agent-http';
import { agentUserId, createAgentMutationSecurity, requireAgentAuthenticated } from './agent-security';

export interface AppThreadsRouterDependencies {
  conversations: AgentConversationFacade;
  nodeEnv: string;
  publicOrigin?: string;
  csrfSecret: string;
}

const pathParam = (value: string | string[] | undefined): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error('VALIDATION_FAILED');
  return value;
};

const queryString = (value: unknown): string | undefined => {
  const scalar = Array.isArray(value) ? value[0] : value;
  return typeof scalar === 'string' && scalar.length > 0 ? scalar : undefined;
};

const parseLimit = (request: Request, fallback: number): number => {
  const raw = queryString(request.query.limit);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 200) throw new Error('VALIDATION_FAILED');
  return value;
};

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED');
  return value as Record<string, unknown>;
};
const positiveVersion = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('VALIDATION_FAILED');
  return Number(value);
};
const onlyKeys = (body: Record<string, unknown>, allowed: readonly string[]): void => {
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw new Error('VALIDATION_FAILED');
};

type Thread = Awaited<ReturnType<AgentConversationFacade['getThread']>>;
type LedgerPage = Awaited<ReturnType<AgentConversationFacade['readPage']>>;

const threadDto = (thread: Thread): AgentThreadViewDto => ({
  id: thread.id,
  appId: thread.appId,
  title: thread.title,
  titleSource: thread.titleSource,
  version: thread.version,
  createdAt: thread.createdAt,
  updatedAt: thread.updatedAt,
  latestRunId: thread.latestRunId,
});

const threadPageDto = (page: Awaited<ReturnType<AgentConversationFacade['listThreads']>>): AgentThreadPageDto => ({
  items: page.items.map(threadDto),
  nextCursor: page.nextCursor,
});

const ledgerEntryDto = (entry: LedgerPage['items'][number]): AgentLedgerEntryDto => ({
  id: entry.id,
  threadId: entry.threadId,
  runId: entry.runId,
  sequence: entry.sequence,
  kind: entry.kind,
  payload: entry.payload,
  createdAt: entry.createdAt,
});

const ledgerPageDto = (page: LedgerPage): AgentLedgerPageDto => ({
  items: page.items.map(ledgerEntryDto),
  nextCursor: page.nextCursor,
});

const createRequest = (value: unknown): AgentThreadCreateRequestDto => {
  const body = record(value);
  onlyKeys(body, ['title']);
  if (body.title !== undefined && body.title !== null && typeof body.title !== 'string') throw new Error('VALIDATION_FAILED');
  return body.title === undefined ? {} : { title: body.title as string | null };
};

const renameRequest = (value: unknown): AgentThreadRenameRequestDto => {
  const body = record(value);
  onlyKeys(body, ['title', 'expectedVersion']);
  if (typeof body.title !== 'string') throw new Error('VALIDATION_FAILED');
  return { title: body.title, expectedVersion: positiveVersion(body.expectedVersion) };
};

const deleteRequest = (value: unknown): AgentThreadDeleteRequestDto => {
  const body = record(value);
  onlyKeys(body, ['expectedVersion']);
  return { expectedVersion: positiveVersion(body.expectedVersion) };
};

const deleteAllRequest = (value: unknown): AgentThreadDeleteAllRequestDto => {
  const body = record(value);
  onlyKeys(body, ['confirmation']);
  if (body.confirmation !== 'delete_all_threads') throw new Error('VALIDATION_FAILED');
  return { confirmation: 'delete_all_threads' };
};

export const createAppThreadsRouter = (dependencies: AppThreadsRouterDependencies): Router => {
  const router = Router({ mergeParams: true });
  const mutationSecurity = createAgentMutationSecurity({
    nodeEnv: dependencies.nodeEnv,
    publicOrigin: dependencies.publicOrigin,
    csrfSecret: dependencies.csrfSecret,
  });

  router.use(requireAgentAuthenticated);

  router.get(
    '/',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const limit = parseLimit(request, 50);
      if (limit > 100) throw new Error('VALIDATION_FAILED');
      const before = queryString(request.query.before);
      const query: AgentThreadListQueryDto = { limit, ...(before === undefined ? {} : { before }) };
      agentData(
        request,
        response,
        threadPageDto(await dependencies.conversations.listThreads(scope, query.limit, query.before)),
      );
    }),
  );

  router.post(
    '/',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = createRequest(request.body);
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const thread = await dependencies.conversations.createThread(
        scope,
        input.title,
        request.header('idempotency-key') || undefined,
      );
      agentData(request, response, threadDto(thread), 201);
    }),
  );

  router.delete(
    '/',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = deleteAllRequest(request.body);
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const result = await dependencies.conversations.deleteAllThreads(scope, input.confirmation);
      const payload: AgentThreadDeleteAllResultDto = { deletedCount: result.deletedCount };
      agentData(request, response, payload, 202);
    }),
  );

  router.patch(
    '/:threadId',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = renameRequest(request.body);
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(
        request,
        response,
        threadDto(
          await dependencies.conversations.renameThread(
            scope,
            pathParam(request.params.threadId),
            input.title,
            input.expectedVersion,
          ),
        ),
      );
    }),
  );

  router.delete(
    '/:threadId',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = deleteRequest(request.body);
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const result = await dependencies.conversations.deleteThread(
        scope,
        pathParam(request.params.threadId),
        input.expectedVersion,
      );
      const payload: AgentThreadDeleteResultDto = { threadId: result.threadId, deleted: true };
      agentData(request, response, payload, 202);
    }),
  );

  router.get(
    '/:threadId',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(
        request,
        response,
        threadDto(await dependencies.conversations.getThread(scope, pathParam(request.params.threadId))),
      );
    }),
  );

  router.get(
    '/:threadId/entries',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const before = queryString(request.query.before);
      const query: AgentLedgerQueryDto = {
        limit: parseLimit(request, 50),
        ...(before === undefined ? {} : { before }),
      };
      agentData(
        request,
        response,
        ledgerPageDto(
          await dependencies.conversations.readPage(
            scope,
            pathParam(request.params.threadId),
            query.limit,
            query.before,
          ),
        ),
      );
    }),
  );

  return router;
};
