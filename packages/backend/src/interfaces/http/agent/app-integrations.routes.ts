import type {
  AgentAcpIntegrationConfigurationDto,
  AgentIntegrationCreateRequestDto,
  AgentIntegrationDeleteQueryDto,
  AgentIntegrationDeleteResponseDto,
  AgentIntegrationListQueryDto,
  AgentIntegrationRefreshDto,
  AgentIntegrationUpdateFieldsDto,
  AgentIntegrationViewDto,
  AgentMcpIntegrationConfigurationDto,
} from '@nexus-terminal/protocol/agent-integrations';
import { Router } from 'express';
import type { AgentIntegrationFacade } from '../../../modules/agent/public';
import { agentData, agentRoute } from './agent-http';
import { agentUserId, createAgentMutationSecurity, requireAgentAuthenticated } from './agent-security';

export interface AppIntegrationsRouterDependencies {
  integrations: AgentIntegrationFacade;
  nodeEnv: string;
  publicOrigin?: string;
  csrfSecret: string;
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

const stringArray = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw new Error('VALIDATION_FAILED');
  return [...value];
};

type IntegrationManagement = Awaited<ReturnType<AgentIntegrationFacade['get']>>;
type IntegrationRefresh = Awaited<ReturnType<AgentIntegrationFacade['refresh']>>;

const integrationDto = (view: IntegrationManagement): AgentIntegrationViewDto => ({
  id: view.id,
  userId: view.userId,
  appId: view.appId,
  kind: view.kind,
  configuration: view.configuration,
  hasCredential: view.hasCredential,
  credentialRevision: view.credentialRevision,
  schemaHash: view.schemaHash,
  enabled: view.enabled,
  refreshState: view.refreshState,
  lastErrorCode: view.lastErrorCode,
  lastAttemptAt: view.lastAttemptAt,
  lastSuccessAt: view.lastSuccessAt,
  nextRetryAt: view.nextRetryAt,
  version: view.version,
  createdAt: view.createdAt,
  updatedAt: view.updatedAt,
});

const refreshDto = (view: IntegrationRefresh): AgentIntegrationRefreshDto => ({
  integration: integrationDto(view.integration),
  serverName: view.serverName,
  serverVersion: view.serverVersion,
  protocolVersion: view.protocolVersion,
  toolCount: view.toolCount,
  resourceCount: view.resourceCount,
  promptCount: view.promptCount,
});

const mcpConfiguration = (value: unknown): AgentMcpIntegrationConfigurationDto => {
  const body = record(value);
  const allowed = new Set([
    'displayName',
    'transport',
    'endpoint',
    'privateHostExceptions',
    'protocolVersion',
    'trustToolAnnotations',
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
  if (
    typeof body.displayName !== 'string' ||
    body.transport !== 'streamable-http' ||
    typeof body.endpoint !== 'string' ||
    body.protocolVersion !== '2026-07-28' ||
    (body.trustToolAnnotations !== undefined && typeof body.trustToolAnnotations !== 'boolean')
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    displayName: body.displayName,
    transport: 'streamable-http',
    endpoint: body.endpoint,
    privateHostExceptions: stringArray(body.privateHostExceptions),
    protocolVersion: '2026-07-28',
    ...(body.trustToolAnnotations === undefined ? {} : { trustToolAnnotations: body.trustToolAnnotations }),
  };
};

const acpConfiguration = (value: unknown): AgentAcpIntegrationConfigurationDto => {
  const body = record(value);
  const allowed = new Set(['displayName', 'transport', 'profileId', 'protocolVersion']);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
  if (
    typeof body.displayName !== 'string' ||
    body.transport !== 'workspace-profile' ||
    typeof body.profileId !== 'string' ||
    body.protocolVersion !== '1'
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return {
    displayName: body.displayName,
    transport: 'workspace-profile',
    profileId: body.profileId,
    protocolVersion: '1',
  };
};

const integrationInput = (value: unknown, updating: boolean): AgentIntegrationUpdateFieldsDto => {
  const body = record(value);
  const allowed = new Set(['kind', 'configuration', 'enabled', 'credential', 'clearCredential']);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new Error('VALIDATION_FAILED');
  if (typeof body.enabled !== 'boolean') throw new Error('VALIDATION_FAILED');
  if (body.kind === 'mcp') {
    if (body.credential !== undefined && typeof body.credential !== 'string') throw new Error('VALIDATION_FAILED');
    if (body.clearCredential !== undefined && typeof body.clearCredential !== 'boolean') throw new Error('VALIDATION_FAILED');
    if (!updating && body.clearCredential === true) throw new Error('VALIDATION_FAILED');
    if (body.credential !== undefined && body.clearCredential === true) throw new Error('VALIDATION_FAILED');
    return {
      kind: 'mcp',
      configuration: mcpConfiguration(body.configuration),
      enabled: body.enabled,
      ...(body.credential === undefined ? {} : { credential: body.credential }),
      ...(body.clearCredential === undefined ? {} : { clearCredential: body.clearCredential }),
    };
  }
  if (body.kind === 'acp') {
    if (body.credential !== undefined || body.clearCredential !== undefined) throw new Error('VALIDATION_FAILED');
    return { kind: 'acp', configuration: acpConfiguration(body.configuration), enabled: body.enabled };
  }
  throw new Error('VALIDATION_FAILED');
};

export const createAppIntegrationsRouter = (dependencies: AppIntegrationsRouterDependencies): Router => {
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
      const kind = request.query.kind;
      if (kind !== undefined && kind !== 'mcp' && kind !== 'acp') throw new Error('VALIDATION_FAILED');
      const query: AgentIntegrationListQueryDto = kind === undefined ? {} : { kind };
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      const payload: AgentIntegrationViewDto[] = (await dependencies.integrations.list(scope, query.kind)).map(
        integrationDto,
      );
      agentData(request, response, payload);
    }),
  );

  router.post(
    '/',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      const input: AgentIntegrationCreateRequestDto = integrationInput(request.body, false);
      const created = await dependencies.integrations.create(scope, input);
      response.setHeader('Location', `/api/v1/apps/${encodeURIComponent(scope.appId)}/integrations/${created.id}`);
      agentData(request, response, integrationDto(created), 201);
    }),
  );

  router.get(
    '/:integrationId',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      agentData(
        request,
        response,
        integrationDto(await dependencies.integrations.get(scope, param(request.params.integrationId))),
      );
    }),
  );

  router.patch(
    '/:integrationId',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const body = record(request.body);
      const version = expectedVersion(body.expectedVersion);
      const { expectedVersion: _ignored, ...rawInput } = body;
      const input = integrationInput(rawInput, true);
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      agentData(
        request,
        response,
        integrationDto(
          await dependencies.integrations.update(scope, param(request.params.integrationId), version, input),
        ),
      );
    }),
  );

  router.post(
    '/:integrationId/refresh',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (Object.keys(record(request.body)).length !== 0) throw new Error('VALIDATION_FAILED');
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      agentData(
        request,
        response,
        refreshDto(await dependencies.integrations.refresh(scope, param(request.params.integrationId))),
      );
    }),
  );

  router.delete(
    '/:integrationId',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const raw = request.query.expectedVersion;
      if (typeof raw !== 'string') throw new Error('VALIDATION_FAILED');
      const query: AgentIntegrationDeleteQueryDto = { expectedVersion: expectedVersion(Number(raw)) };
      const integrationId = param(request.params.integrationId);
      const scope = { userId: agentUserId(request), appId: param(request.params.appId) };
      await dependencies.integrations.remove(scope, integrationId, query.expectedVersion);
      const payload: AgentIntegrationDeleteResponseDto = { integrationId, deleted: true };
      agentData(request, response, payload, 202);
    }),
  );

  return router;
};
