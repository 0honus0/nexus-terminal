import { Router } from 'express';
import type { AgentIntegrationFacade } from '../../../modules/agent/public';
import type { IntegrationKind } from '../../../modules/agent/ai/integrations.types';
import { agentData, agentRoute } from './agent-http';
import { agentUserId, createAgentMutationSecurity, requireAgentAuthenticated } from './agent-security';

export interface AppIntegrationsRouterDependencies {
  integrations: AgentIntegrationFacade;
  nodeEnv: string;
  publicOrigin?: string;
}

const param = (value: string | string[] | undefined): string => {
  if (typeof value !== 'string' || !value) throw new Error('VALIDATION_FAILED');
  return value;
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('VALIDATION_FAILED');
  return value as Record<string, unknown>;
};
const expectedVersion = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error('VALIDATION_FAILED');
  return value as number;
};

export const createAppIntegrationsRouter = (dependencies: AppIntegrationsRouterDependencies): Router => {
  const router = Router({ mergeParams: true });
  const mutationSecurity = createAgentMutationSecurity({
    nodeEnv: dependencies.nodeEnv,
    publicOrigin: dependencies.publicOrigin,
  });
  router.use(requireAgentAuthenticated);

  router.get(
    '/',
    agentRoute(async (request, response) => {
      const kind = request.query.kind;
      if (kind !== undefined && kind !== 'mcp' && kind !== 'acp') throw new Error('VALIDATION_FAILED');
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      agentData(request, response, await dependencies.integrations.list(scope, kind as IntegrationKind | undefined));
    }),
  );

  router.post(
    '/',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      const created = await dependencies.integrations.create(scope, request.body);
      response.setHeader('Location', `/api/v1/apps/${encodeURIComponent(scope.appId)}/integrations/${created.id}`);
      agentData(request, response, created, 201);
    }),
  );

  router.get(
    '/:integrationId',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      agentData(request, response, await dependencies.integrations.get(scope, param(request.params.integrationId)));
    }),
  );

  router.patch(
    '/:integrationId',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const body = record(request.body);
      const version = expectedVersion(body.expectedVersion);
      const { expectedVersion: _ignored, ...input } = body;
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      agentData(
        request,
        response,
        await dependencies.integrations.update(scope, param(request.params.integrationId), version, input),
      );
    }),
  );

  router.post(
    '/:integrationId/refresh',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (Object.keys(record(request.body)).length !== 0) throw new Error('VALIDATION_FAILED');
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      agentData(request, response, await dependencies.integrations.refresh(scope, param(request.params.integrationId)));
    }),
  );

  router.delete(
    '/:integrationId',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const raw = request.query.expectedVersion;
      if (typeof raw !== 'string') throw new Error('VALIDATION_FAILED');
      const version = expectedVersion(Number(raw));
      const integrationId = param(request.params.integrationId);
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      await dependencies.integrations.remove(scope, integrationId, version);
      agentData(request, response, { integrationId, deleted: true }, 202);
    }),
  );

  return router;
};
