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
      agentData(
        request,
        response,
        await dependencies.conversations.listThreads(scope, parseLimit(request, 50), queryString(request.query.before)),
      );
    }),
  );

  router.post(
    '/',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body))
        throw new Error('VALIDATION_FAILED');
      const body = request.body as Record<string, unknown>;
      if (Object.keys(body).some((key) => key !== 'title')) throw new Error('VALIDATION_FAILED');
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const thread = await dependencies.conversations.createThread(scope, body.title);
      agentData(request, response, thread, 201);
    }),
  );

  router.get(
    '/:threadId',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(
        request,
        response,
        await dependencies.conversations.getThread(scope, pathParam(request.params.threadId)),
      );
    }),
  );

  router.get(
    '/:threadId/entries',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(
        request,
        response,
        await dependencies.conversations.readPage(
          scope,
          pathParam(request.params.threadId),
          parseLimit(request, 50),
          queryString(request.query.before),
        ),
      );
    }),
  );

  return router;
};
