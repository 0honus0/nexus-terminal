import { Router, type Request } from 'express';
import { create as createContentDisposition } from 'content-disposition';
import parseRange from 'range-parser';
import { AGENT_CAPABILITIES, type AgentCapability } from '../../../modules/agent/host/app.types';
import type {
  AgentArtifactFacade,
  AgentEventFacade,
  AgentWorkspaceRuntimeFacade,
  AgentHostFacade,
  AgentPluginFacade,
  AgentProviderFacade,
  AppView,
} from '../../../modules/agent/public';
import { agentData, agentError, agentRoute } from './agent-http';
import {
  hasOnlyKeys,
  isJsonValue,
  isRecord,
  nonEmptyString,
  pathParam,
  positiveInteger,
  queryString,
} from './agent-route-input';
import { agentUserId, createAgentMutationSecurity, issueAgentCsrf, requireAgentAuthenticated } from './agent-security';
import { createPluginRouter } from './plugins.routes';
import { createWorkspaceRuntimeRouter } from './workspace-runtime.routes';

export interface AgentRouterDependencies {
  host: AgentHostFacade;
  plugins: AgentPluginFacade;
  providers: AgentProviderFacade;
  artifacts: AgentArtifactFacade;
  events: AgentEventFacade;
  workspaceRuntime: AgentWorkspaceRuntimeFacade;
  nodeEnv: string;
  publicOrigin?: string;
  csrfSecret: string;
}

const appIntentRangeFor = (
  header: string | undefined,
  sizeBytes: number,
): { start: number; endInclusive: number; partial: boolean } => {
  if (sizeBytes === 0) return { start: 0, endInclusive: -1, partial: false };
  if (!header) {
    return { start: 0, endInclusive: Math.min(sizeBytes - 1, 1024 * 1024 - 1), partial: sizeBytes > 1024 * 1024 };
  }
  const parsed = parseRange(sizeBytes, header, { combine: false });
  if (parsed === -1 || parsed === -2 || parsed.type !== 'bytes' || parsed.length !== 1) {
    throw new Error('APP_INTENT_ARTIFACT_RANGE_INVALID');
  }
  const requested = parsed[0]!;
  const start = requested.start;
  const openEnded = /^bytes=\d+-$/.test(header.trim());
  const endInclusive = openEnded ? Math.min(requested.end, start + 8 * 1024 * 1024 - 1) : requested.end;
  if (endInclusive - start + 1 > 8 * 1024 * 1024) throw new Error('APP_INTENT_ARTIFACT_RANGE_INVALID');
  return { start, endInclusive, partial: true };
};

const appIntentContentDisposition = (name: string): string =>
  createContentDisposition(name.slice(0, 180) || 'artifact', { type: 'attachment' });

const appSummary = (app: AppView) => ({
  id: app.appId,
  displayName: app.displayName,
  version: app.activeVersion,
  stateVersion: app.version,
  enabled: app.desiredState === 'enabled',
  health:
    app.observedState === 'running'
      ? 'healthy'
      : app.observedState === 'degraded'
        ? 'degraded'
        : app.observedState === 'disabled'
          ? 'disabled'
          : app.observedState === 'failed'
            ? 'failed'
            : app.observedState,
  healthReason: app.healthReason,
  runningRuns: app.runningCount,
  pendingApprovals: app.approvalCount,
  pendingBudgetRequests: app.budgetRequestCount,
});

const providerInputKeys = [
  'kind',
  'displayName',
  'baseUrl',
  'credential',
  'clearCredential',
  'models',
  'privateHostExceptions',
  'enabled',
] as const;

const providerPatchInput = async (
  providers: AgentProviderFacade,
  currentUserId: number,
  providerId: string,
  body: Record<string, unknown>,
): Promise<{ expectedVersion: number; input: Record<string, unknown> }> => {
  if (!positiveInteger(body.expectedVersion)) throw new Error('VALIDATION_FAILED');
  if (!hasOnlyKeys(body, [...providerInputKeys, 'expectedVersion'])) throw new Error('VALIDATION_FAILED');
  const current = await providers.get(currentUserId, providerId);
  const input: Record<string, unknown> = {
    kind: body.kind ?? current.kind,
    displayName: body.displayName ?? current.displayName,
    baseUrl: body.baseUrl ?? current.baseUrl,
    models: body.models ?? current.models,
    privateHostExceptions: body.privateHostExceptions ?? current.privateHostExceptions,
    enabled: body.enabled ?? current.enabled,
  };
  if ('credential' in body) input.credential = body.credential;
  if ('clearCredential' in body) input.clearCredential = body.clearCredential;
  return { expectedVersion: body.expectedVersion, input };
};

export const createAgentRouter = (dependencies: AgentRouterDependencies): Router => {
  const router = Router();
  const mutationSecurity = createAgentMutationSecurity({
    nodeEnv: dependencies.nodeEnv,
    publicOrigin: dependencies.publicOrigin,
    csrfSecret: dependencies.csrfSecret,
  });

  router.use(requireAgentAuthenticated);

  router.get(
    '/security/csrf',
    agentRoute(async (request, response) => issueAgentCsrf(request, response, dependencies.csrfSecret)),
  );

  router.use('/plugins', createPluginRouter(dependencies.plugins, mutationSecurity));

  router.get(
    '/apps',
    agentRoute(async (request, response) => {
      const apps = await dependencies.host.listApps(agentUserId(request));
      agentData(request, response, apps.map(appSummary));
    }),
  );

  router.get(
    '/apps/:appId/grants',
    agentRoute(async (request, response) => {
      const userId = agentUserId(request);
      const appId = pathParam(request.params.appId);
      const [app, grants] = await Promise.all([
        dependencies.host.getApp(userId, appId),
        dependencies.host.listAppGrants(userId, appId),
      ]);
      agentData(request, response, {
        app: appSummary(app),
        policyRevision: app.policyRevision,
        declaredCapabilities: [...app.capabilities],
        grants,
      });
    }),
  );

  router.put(
    '/apps/:appId/grants',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['capabilities', 'expectedPolicyRevision'])) {
        throw new Error('VALIDATION_FAILED');
      }
      const capabilities = request.body.capabilities;
      if (
        !Array.isArray(capabilities) ||
        capabilities.length > AGENT_CAPABILITIES.length ||
        capabilities.some(
          (value) => typeof value !== 'string' || !AGENT_CAPABILITIES.includes(value as AgentCapability),
        ) ||
        new Set(capabilities).size !== capabilities.length ||
        !positiveInteger(request.body.expectedPolicyRevision)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const updated = await dependencies.host.replaceAppGrants(
        agentUserId(request),
        pathParam(request.params.appId),
        capabilities as AgentCapability[],
        request.body.expectedPolicyRevision,
      );
      agentData(request, response, {
        app: appSummary(updated.app),
        policyRevision: updated.app.policyRevision,
        declaredCapabilities: [...updated.app.capabilities],
        grants: updated.grants,
      });
    }),
  );

  router.post(
    '/apps/:appId/plugin-intents',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['receiverAppId', 'intentId', 'input', 'artifactRefs', 'confirmed']) ||
        !nonEmptyString(request.body.receiverAppId) ||
        !nonEmptyString(request.body.intentId) ||
        !isJsonValue(request.body.input) ||
        !Array.isArray(request.body.artifactRefs) ||
        request.body.artifactRefs.length > 16 ||
        request.body.confirmed !== true
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const artifactRefs: Array<{ appId: string; id: string }> = [];
      for (const candidate of request.body.artifactRefs) {
        if (
          !isRecord(candidate) ||
          !hasOnlyKeys(candidate, ['appId', 'id']) ||
          !nonEmptyString(candidate.appId) ||
          !nonEmptyString(candidate.id)
        ) {
          throw new Error('VALIDATION_FAILED');
        }
        artifactRefs.push({ appId: candidate.appId, id: candidate.id });
      }
      const receipt = await dependencies.host.createAppIntent(
        { userId: agentUserId(request), appId: pathParam(request.params.appId) },
        {
          receiverAppId: request.body.receiverAppId,
          intentId: request.body.intentId,
          input: request.body.input,
          artifactRefs,
          confirmed: true,
        },
      );
      agentData(request, response, receipt, 201);
    }),
  );

  router.get(
    '/apps/:appId/plugin-intents',
    agentRoute(async (request, response) => {
      const rawLimit = queryString(request.query.limit);
      const limit = rawLimit === undefined ? undefined : Number(rawLimit);
      if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)) {
        throw new Error('VALIDATION_FAILED');
      }
      agentData(
        request,
        response,
        await dependencies.host.listReceivedAppIntents(
          { userId: agentUserId(request), appId: pathParam(request.params.appId) },
          limit,
        ),
      );
    }),
  );

  router.get(
    '/apps/:appId/plugin-intents/:receiptId/artifacts/:artifactId',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(
        request,
        response,
        await dependencies.host.getReceivedAppIntentArtifact(
          scope,
          pathParam(request.params.receiptId),
          pathParam(request.params.artifactId),
        ),
      );
    }),
  );

  router.get(
    '/apps/:appId/plugin-intents/:receiptId/artifacts/:artifactId/content',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      const receiptId = pathParam(request.params.receiptId);
      const artifactId = pathParam(request.params.artifactId);
      const artifact = await dependencies.host.getReceivedAppIntentArtifact(scope, receiptId, artifactId);
      if (request.header('if-none-match') === `"${artifact.sha256}"`) {
        response.status(304).end();
        return;
      }
      response.setHeader('ETag', `"${artifact.sha256}"`);
      response.setHeader('Content-Type', artifact.mediaType);
      response.setHeader('Content-Disposition', appIntentContentDisposition(artifact.originalName));
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (artifact.sizeBytes === 0) {
        response.setHeader('Content-Length', '0');
        response.status(200).end();
        return;
      }

      const range = appIntentRangeFor(request.header('range'), artifact.sizeBytes);
      const readable = await dependencies.host.readReceivedAppIntentArtifact(scope, receiptId, artifactId, range);
      response.setHeader('Accept-Ranges', 'bytes');
      response.setHeader('Content-Length', String(range.endInclusive - range.start + 1));
      if (range.partial) {
        response.status(206);
        response.setHeader('Content-Range', `bytes ${range.start}-${range.endInclusive}/${artifact.sizeBytes}`);
      }
      for await (const chunk of readable.source) response.write(chunk);
      response.end();
    }),
  );

  router.delete(
    '/apps/:appId/plugin-intents/:receiptId',
    mutationSecurity,
    agentRoute(async (request, response) => {
      await dependencies.host.revokeAppIntent(
        { userId: agentUserId(request), appId: pathParam(request.params.appId) },
        pathParam(request.params.receiptId),
      );
      agentData(request, response, { revoked: true });
    }),
  );

  router.get('/events', (request, response) => {
    agentError(
      request,
      response,
      410,
      'AGENT_STREAM_PROTOCOL_REPLACED',
      'Agent event streaming moved to the /ws/agent WebSocket protocol.',
    );
  });

  router.get(
    '/summary',
    agentRoute(async (request, response) => {
      const userId = agentUserId(request);
      const [apps, settings, eventCursor] = await Promise.all([
        dependencies.host.listApps(userId),
        dependencies.host.getSettings(userId),
        dependencies.events.hostCursor(userId),
      ]);
      const summaries = apps.map(appSummary);
      const totalRunningRuns = summaries.reduce((total, app) => total + app.runningRuns, 0);
      const totalPendingApprovals = summaries.reduce((total, app) => total + app.pendingApprovals, 0);
      const totalPendingBudgetRequests = summaries.reduce((total, app) => total + app.pendingBudgetRequests, 0);
      const featureEnabled = settings.effectiveSettings.feature.enabled;
      agentData(request, response, {
        featureEnabled,
        hostState: featureEnabled ? 'enabled' : totalRunningRuns > 0 ? 'disabling' : 'disabled',
        apps: summaries,
        totalRunningRuns,
        totalPendingApprovals,
        totalPendingBudgetRequests,
        eventCursor,
      });
    }),
  );

  router.patch(
    '/apps/:appId',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['enabled', 'expectedVersion'])) {
        agentError(request, response, 400, 'VALIDATION_FAILED', 'Invalid Agent App update.');
        return;
      }
      if (typeof request.body.enabled !== 'boolean' || !positiveInteger(request.body.expectedVersion)) {
        agentError(request, response, 400, 'VALIDATION_FAILED', 'Invalid Agent App update.');
        return;
      }
      const app = await dependencies.host.setAppEnabled(
        agentUserId(request),
        pathParam(request.params.appId),
        request.body.enabled,
        request.body.expectedVersion,
      );
      agentData(request, response, appSummary(app), app.observedState === 'disabling' ? 202 : 200);
    }),
  );

  router.get(
    '/target-denylist',
    agentRoute(async (request, response) => {
      const snapshot = await dependencies.host.getTargetDenylist();
      agentData(request, response, { revision: snapshot.revision, list: snapshot.entries });
    }),
  );

  router.put(
    '/target-denylist',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['connectionIds', 'reason', 'expectedRevision'])) {
        throw new Error('VALIDATION_FAILED');
      }
      if (
        !Array.isArray(request.body.connectionIds) ||
        request.body.connectionIds.length > 50 ||
        request.body.connectionIds.some((value) => !positiveInteger(value)) ||
        typeof request.body.reason !== 'string' ||
        request.body.reason.trim().length < 1 ||
        request.body.reason.trim().length > 512 ||
        !positiveInteger(request.body.expectedRevision)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const connectionIds = [...new Set(request.body.connectionIds as number[])].sort((left, right) => left - right);
      const updated = await dependencies.host.replaceTargetDenylist(
        agentUserId(request),
        connectionIds,
        request.body.reason.trim(),
        request.body.expectedRevision,
      );
      agentData(request, response, { revision: updated.revision, list: updated.entries });
    }),
  );

  router.get(
    '/settings',
    agentRoute(async (request, response) => {
      const settings = await dependencies.host.getSettings(agentUserId(request));
      agentData(request, response, {
        ...settings,
        availability: {
          state: settings.effectiveSettings.feature.enabled ? 'enabled' : 'disabled',
        },
        runtimeCapabilities: {
          workspaceRuntimeController: false,
        },
      });
    }),
  );

  router.patch(
    '/settings',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['patch', 'expectedVersion'])) {
        agentError(request, response, 400, 'VALIDATION_FAILED', 'Invalid Agent settings update.');
        return;
      }
      if (!isRecord(request.body.patch) || !positiveInteger(request.body.expectedVersion)) {
        agentError(request, response, 400, 'VALIDATION_FAILED', 'Invalid Agent settings update.');
        return;
      }
      const settings = await dependencies.host.patchSettings(
        agentUserId(request),
        request.body.patch,
        request.body.expectedVersion,
      );
      agentData(request, response, {
        ...settings,
        availability: {
          state: settings.effectiveSettings.feature.enabled ? 'enabled' : 'disabled',
        },
        runtimeCapabilities: {
          workspaceRuntimeController: false,
        },
      });
    }),
  );

  router.post(
    '/settings/hard-limits/preview',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['proposed', 'expectedVersion']) ||
        !isRecord(request.body.proposed) ||
        !positiveInteger(request.body.expectedVersion)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const preview = await dependencies.host.previewHardLimits(
        agentUserId(request),
        request.body.proposed,
        request.body.expectedVersion,
      );
      agentData(request, response, {
        ...preview,
        runtimeCapabilities: {
          workspaceRuntimeController: false,
        },
      });
    }),
  );

  router.post(
    '/settings/hard-limits/confirm',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['confirmationId', 'expectedVersion']) ||
        !nonEmptyString(request.body.confirmationId) ||
        !positiveInteger(request.body.expectedVersion)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const settings = await dependencies.host.confirmHardLimits(
        agentUserId(request),
        request.body.confirmationId,
        request.body.expectedVersion,
      );
      agentData(request, response, {
        ...settings,
        availability: {
          state: settings.effectiveSettings.feature.enabled ? 'enabled' : 'disabled',
        },
        runtimeCapabilities: {
          workspaceRuntimeController: false,
        },
      });
    }),
  );

  router.get(
    '/ai/models',
    agentRoute(async (request, response) => {
      const providers = await dependencies.providers.list(agentUserId(request));
      agentData(
        request,
        response,
        providers
          .filter((provider) => provider.enabled)
          .flatMap((provider) =>
            provider.models.map((model) => ({
              providerId: provider.id,
              providerDisplayName: provider.displayName,
              configurationVersion: provider.version,
              modelId: model.id,
              contextWindow: model.contextWindow,
              maxOutputTokens: model.maxOutputTokens,
              supportsTools: model.supportsTools,
              pricing: {
                known:
                  Number.isSafeInteger(model.priceMicrosPerMillionInput) &&
                  Number.isSafeInteger(model.priceMicrosPerMillionOutput),
                inputMicrosPerMillion: model.priceMicrosPerMillionInput ?? null,
                outputMicrosPerMillion: model.priceMicrosPerMillionOutput ?? null,
                priceVersion: model.priceVersion ?? null,
              },
            })),
          ),
      );
    }),
  );

  router.get(
    '/ai/providers',
    agentRoute(async (request, response) => {
      agentData(request, response, await dependencies.providers.list(agentUserId(request)));
    }),
  );

  router.post(
    '/ai/providers',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const provider = await dependencies.providers.create(agentUserId(request), request.body);
      agentData(request, response, provider, 201);
    }),
  );

  router.patch(
    '/ai/providers/:providerId',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body)) throw new Error('VALIDATION_FAILED');
      const currentUserId = agentUserId(request);
      const providerId = pathParam(request.params.providerId);
      const { expectedVersion, input } = await providerPatchInput(
        dependencies.providers,
        currentUserId,
        providerId,
        request.body,
      );
      agentData(
        request,
        response,
        await dependencies.providers.update(currentUserId, providerId, expectedVersion, input),
      );
    }),
  );

  router.delete(
    '/ai/providers/:providerId',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const rawVersion = Array.isArray(request.query.expectedVersion)
        ? request.query.expectedVersion[0]
        : request.query.expectedVersion;
      const expectedVersion = typeof rawVersion === 'string' ? Number(rawVersion) : Number.NaN;
      if (!positiveInteger(expectedVersion)) throw new Error('VALIDATION_FAILED');
      await dependencies.providers.remove(agentUserId(request), pathParam(request.params.providerId), expectedVersion);
      agentData(request, response, { deleted: true });
    }),
  );

  router.post(
    '/ai/providers/:providerId/test',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['modelId']) || !nonEmptyString(request.body.modelId)) {
        throw new Error('VALIDATION_FAILED');
      }
      agentData(
        request,
        response,
        await dependencies.providers.test(
          agentUserId(request),
          pathParam(request.params.providerId),
          request.body.modelId,
        ),
      );
    }),
  );

  router.get(
    '/files',
    agentRoute(async (request, response) => {
      const rawLimit = queryString(request.query.limit);
      const limit = rawLimit === undefined ? 50 : Number(rawLimit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('VALIDATION_FAILED');
      const retainedRaw = queryString(request.query.retained);
      if (retainedRaw !== undefined && retainedRaw !== 'true' && retainedRaw !== 'false') {
        throw new Error('VALIDATION_FAILED');
      }
      const page = await dependencies.artifacts.listLibrary(agentUserId(request), {
        limit,
        ...(queryString(request.query.before) ? { before: queryString(request.query.before) } : {}),
        ...(queryString(request.query.q) ? { q: queryString(request.query.q) } : {}),
        ...(queryString(request.query.appId) ? { appId: queryString(request.query.appId) } : {}),
        ...(retainedRaw === undefined ? {} : { retained: retainedRaw === 'true' }),
      });
      agentData(request, response, page);
    }),
  );

  router.get(
    '/files/storage',
    agentRoute(async (request, response) => {
      agentData(request, response, await dependencies.artifacts.storageSummary(agentUserId(request)));
    }),
  );

  router.post(
    '/files/cleanup/preview',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        request.body !== undefined &&
        request.body !== null &&
        (!isRecord(request.body) || Object.keys(request.body).length > 0)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      agentData(request, response, await dependencies.artifacts.cleanupPreview(agentUserId(request)));
    }),
  );

  router.post(
    '/files/cleanup/confirm',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['confirmationId']) ||
        !nonEmptyString(request.body.confirmationId)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      agentData(
        request,
        response,
        await dependencies.artifacts.cleanupConfirm(agentUserId(request), request.body.confirmationId),
      );
    }),
  );

  router.post(
    '/files/:artifactId/attach',
    mutationSecurity,
    agentRoute(async (request, response) => {
      agentData(
        request,
        response,
        await dependencies.artifacts.attach(agentUserId(request), pathParam(request.params.artifactId), request.body),
      );
    }),
  );

  router.post(
    '/apps/:appId/workspaces/:workspaceId/plugins/:targetPluginId/artifacts/export',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['path', 'name', 'mediaType']) ||
        !nonEmptyString(request.body.path) ||
        !request.body.path.startsWith('/') ||
        request.body.path.length > 4096 ||
        !nonEmptyString(request.body.name) ||
        Buffer.byteLength(request.body.name, 'utf8') > 512 ||
        !nonEmptyString(request.body.mediaType) ||
        request.body.mediaType.length > 128
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(
        request,
        response,
        await dependencies.workspaceRuntime.exportWorkspaceArtifact(
          scope,
          {
            workspaceId: pathParam(request.params.workspaceId),
            targetPluginId: pathParam(request.params.targetPluginId),
            path: request.body.path,
            name: request.body.name.trim(),
            mediaType: request.body.mediaType.trim().toLowerCase(),
          },
          AbortSignal.timeout(120_000),
        ),
        201,
      );
    }),
  );

  router.post(
    '/apps/:appId/workspaces/:workspaceId/plugins/:targetPluginId/artifacts/import',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['artifactId', 'path']) ||
        !nonEmptyString(request.body.artifactId) ||
        !nonEmptyString(request.body.path) ||
        !request.body.path.startsWith('/') ||
        request.body.path.length > 4096
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(
        request,
        response,
        await dependencies.workspaceRuntime.importArtifactToWorkspace(
          scope,
          {
            workspaceId: pathParam(request.params.workspaceId),
            targetPluginId: pathParam(request.params.targetPluginId),
            path: request.body.path,
            artifactId: request.body.artifactId,
          },
          AbortSignal.timeout(120_000),
        ),
      );
    }),
  );

  router.get(
    '/apps/:appId/workspaces/:workspaceId/plugins/:targetPluginId/grants',
    agentRoute(async (request, response) => {
      agentData(
        request,
        response,
        await dependencies.workspaceRuntime.workspaceGrants(
          { userId: agentUserId(request), appId: pathParam(request.params.appId) },
          pathParam(request.params.workspaceId),
          pathParam(request.params.targetPluginId),
        ),
      );
    }),
  );

  router.put(
    '/apps/:appId/workspaces/:workspaceId/plugins/:targetPluginId/grants',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['grants', 'expectedRevision']) ||
        !Array.isArray(request.body.grants) ||
        !positiveInteger(request.body.expectedRevision)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const grants = request.body.grants.map((candidate) => {
        if (!isRecord(candidate) || !hasOnlyKeys(candidate, ['principalPluginId', 'path', 'permissions'])) {
          throw new Error('VALIDATION_FAILED');
        }
        if (
          !nonEmptyString(candidate.principalPluginId) ||
          !nonEmptyString(candidate.path) ||
          !candidate.path.startsWith('/') ||
          candidate.path.length > 4096 ||
          !Array.isArray(candidate.permissions) ||
          candidate.permissions.length < 1 ||
          candidate.permissions.length > 4
        ) {
          throw new Error('VALIDATION_FAILED');
        }
        const permissions = candidate.permissions.map(String);
        if (
          new Set(permissions).size !== permissions.length ||
          permissions.some((permission) => !['read', 'write', 'list', 'delete'].includes(permission))
        ) {
          throw new Error('VALIDATION_FAILED');
        }
        return {
          principalPluginId: candidate.principalPluginId,
          path: candidate.path,
          permissions: permissions as Array<'read' | 'write' | 'list' | 'delete'>,
        };
      });
      agentData(
        request,
        response,
        await dependencies.workspaceRuntime.replaceWorkspaceGrants(
          { userId: agentUserId(request), appId: pathParam(request.params.appId) },
          pathParam(request.params.workspaceId),
          pathParam(request.params.targetPluginId),
          grants,
          request.body.expectedRevision,
        ),
      );
    }),
  );

  router.use('/workspace-runtime', createWorkspaceRuntimeRouter(dependencies.workspaceRuntime, mutationSecurity));

  return router;
};
