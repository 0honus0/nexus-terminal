import { Router, type Request } from 'express';
import { create as createContentDisposition } from 'content-disposition';
import parseRange from 'range-parser';
import type { JsonValue } from '../../../modules/agent/agent.types';
import { AGENT_CAPABILITIES, type AgentCapability } from '../../../modules/agent/host/app.types';
import type {
  AgentArtifactFacade,
  AgentEventFacade,
  AgentEnvironmentFacade,
  AgentHostFacade,
  AgentPluginFacade,
  AgentProviderFacade,
  AppView,
} from '../../../modules/agent/public';
import { agentData, agentError, agentRoute } from './agent-http';
import { agentUserId, createAgentMutationSecurity, issueAgentCsrf, requireAgentAuthenticated } from './agent-security';
import {
  acquireAgentSseSlot,
  AgentSseWriter,
  initializeSseResponse,
  reloadAgentSession,
  resolveSseCursor,
  waitForSseWake,
} from './agent-sse';

export interface AgentRouterDependencies {
  host: AgentHostFacade;
  plugins: AgentPluginFacade;
  providers: AgentProviderFacade;
  artifacts: AgentArtifactFacade;
  events: AgentEventFacade;
  environments: AgentEnvironmentFacade;
  nodeEnv: string;
  publicOrigin?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isJsonValue = (value: unknown, depth = 0): value is JsonValue => {
  if (depth > 64) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.values(value).every((item) => isJsonValue(item, depth + 1));
};

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
};

const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const queryString = (value: unknown): string | undefined => {
  const scalar = Array.isArray(value) ? value[0] : value;
  return typeof scalar === 'string' && scalar.length > 0 ? scalar : undefined;
};

const pathParam = (value: string | string[] | undefined): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error('VALIDATION_FAILED');
  return value;
};

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

const hostEventFrame = (userId: number, event: Awaited<ReturnType<AgentEventFacade['readHost']>>[number]): string =>
  `id: host:${userId}:${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify({
    occurredAt: event.occurredAt,
    payload: event.payload,
  })}\n\n`;

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
  });

  router.use(requireAgentAuthenticated);

  router.get(
    '/security/csrf',
    agentRoute(async (request, response) => issueAgentCsrf(request, response)),
  );

  router.get(
    '/plugins/publishers',
    agentRoute(async (request, response) => {
      const keys = await dependencies.plugins.listPublisherKeys(agentUserId(request));
      agentData(
        request,
        response,
        keys.map(({ publicKeyPem: _publicKeyPem, ...key }) => key),
      );
    }),
  );

  router.post(
    '/plugins/publishers',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['publicKeyPem', 'label']))
        throw new Error('VALIDATION_FAILED');
      if (!nonEmptyString(request.body.publicKeyPem) || !nonEmptyString(request.body.label))
        throw new Error('VALIDATION_FAILED');
      const key = await dependencies.plugins.trustPublisherKey(
        agentUserId(request),
        request.body.publicKeyPem,
        request.body.label,
      );
      const { publicKeyPem: _publicKeyPem, ...view } = key;
      agentData(request, response, view, 201);
    }),
  );

  router.delete(
    '/plugins/publishers/:keyId',
    mutationSecurity,
    agentRoute(async (request, response) => {
      await dependencies.plugins.revokePublisherKey(agentUserId(request), pathParam(request.params.keyId));
      agentData(request, response, { revoked: true });
    }),
  );

  router.get(
    '/plugins/installations',
    agentRoute(async (request, response) => {
      agentData(request, response, await dependencies.plugins.listInstallations(agentUserId(request)));
    }),
  );

  router.get(
    '/plugins/versions',
    agentRoute(async (request, response) => {
      const appId = queryString(request.query.appId);
      agentData(request, response, await dependencies.plugins.listVersions(agentUserId(request), appId));
    }),
  );

  router.post(
    '/plugins/stage',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['artifactRef']) ||
        !isRecord(request.body.artifactRef)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const artifactRef = request.body.artifactRef;
      if (
        !hasOnlyKeys(artifactRef, ['appId', 'id']) ||
        !nonEmptyString(artifactRef.appId) ||
        !nonEmptyString(artifactRef.id)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      agentData(
        request,
        response,
        await dependencies.plugins.stage(agentUserId(request), {
          artifactAppId: artifactRef.appId,
          artifactId: artifactRef.id,
        }),
        201,
      );
    }),
  );

  router.post(
    '/plugins/verify',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['stageId']) || !nonEmptyString(request.body.stageId)) {
        throw new Error('VALIDATION_FAILED');
      }
      agentData(request, response, await dependencies.plugins.verify(agentUserId(request), request.body.stageId));
    }),
  );

  router.post(
    '/plugins/install',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['stageId']) || !nonEmptyString(request.body.stageId)) {
        throw new Error('VALIDATION_FAILED');
      }
      agentData(request, response, await dependencies.plugins.install(agentUserId(request), request.body.stageId), 201);
    }),
  );

  router.get(
    '/plugins/:appId/frontend',
    agentRoute(async (request, response) => {
      const descriptor = await dependencies.plugins.frontendDescriptor(
        agentUserId(request),
        pathParam(request.params.appId),
      );
      if (!descriptor) {
        agentError(request, response, 404, 'NOT_FOUND', 'Plugin UI is not available.');
        return;
      }
      agentData(request, response, descriptor);
    }),
  );

  router.post(
    '/plugins/:appId/frontend/rpc',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['method', 'params']))
        throw new Error('VALIDATION_FAILED');
      if (
        !['host.appInfo', 'storage.get', 'storage.put', 'storage.delete'].includes(String(request.body.method)) ||
        !Object.prototype.hasOwnProperty.call(request.body, 'params') ||
        !isJsonValue(request.body.params)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      agentData(
        request,
        response,
        await dependencies.plugins.frontendRpc(agentUserId(request), pathParam(request.params.appId), {
          method: request.body.method as 'host.appInfo' | 'storage.get' | 'storage.put' | 'storage.delete',
          params: request.body.params,
        }),
      );
    }),
  );

  router.post(
    '/plugins/:appId/upgrade',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['stageId', 'expectedVersion']) ||
        !nonEmptyString(request.body.stageId) ||
        !positiveInteger(request.body.expectedVersion)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const result = await dependencies.plugins.upgrade(
        agentUserId(request),
        pathParam(request.params.appId),
        request.body.stageId,
        request.body.expectedVersion,
      );
      agentData(request, response, result, result.state === 'draining' ? 202 : 200);
    }),
  );

  router.post(
    '/plugins/:appId/uninstall',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['deleteData', 'expectedVersion']) ||
        request.body.deleteData !== false ||
        !positiveInteger(request.body.expectedVersion)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const result = await dependencies.plugins.uninstall(
        agentUserId(request),
        pathParam(request.params.appId),
        request.body.expectedVersion,
      );
      agentData(request, response, result, result.state === 'draining' ? 202 : 200);
    }),
  );

  router.post(
    '/plugins/:appId/delete-data',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['confirmed']) || request.body.confirmed !== true) {
        throw new Error('VALIDATION_FAILED');
      }
      await dependencies.plugins.deleteData(agentUserId(request), pathParam(request.params.appId));
      agentData(request, response, { deleted: true });
    }),
  );

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

  router.get(
    '/events',
    agentRoute(async (request, response) => {
      const userId = agentUserId(request);
      const highWater = await dependencies.events.hostCursor(userId);
      let cursor = resolveSseCursor(request, `host:${userId}:`, highWater);
      const releaseSlot = acquireAgentSseSlot(request);
      initializeSseResponse(response);
      const writer = new AgentSseWriter(response);
      const startedAt = Date.now();
      let lastHeartbeatAt = startedAt;
      let lastAuthCheckAt = startedAt;
      try {
        while (!writer.closed && Date.now() - startedAt < 10 * 60 * 1000) {
          const page = await dependencies.events.readHost(userId, cursor, 100);
          if (page.length > 0) {
            for (const event of page) {
              if (!writer.enqueue(hostEventFrame(userId, event))) break;
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
          await waitForSseWake((wake) => dependencies.events.onHostWake(userId, wake));
        }
      } finally {
        releaseSlot();
        writer.close(true);
      }
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
          environmentController: false,
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
          environmentController: false,
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
          environmentController: false,
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
          environmentController: false,
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
    '/apps/:appId/environments/:environmentId/workspaces/:targetPluginId/artifacts/export',
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
        await dependencies.environments.exportWorkspaceArtifact(
          scope,
          {
            environmentId: pathParam(request.params.environmentId),
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
    '/apps/:appId/environments/:environmentId/workspaces/:targetPluginId/artifacts/import',
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
        await dependencies.environments.importArtifactToWorkspace(
          scope,
          {
            environmentId: pathParam(request.params.environmentId),
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
    '/apps/:appId/environments/:environmentId/workspaces/:targetPluginId/grants',
    agentRoute(async (request, response) => {
      agentData(
        request,
        response,
        await dependencies.environments.workspaceGrants(
          { userId: agentUserId(request), appId: pathParam(request.params.appId) },
          pathParam(request.params.environmentId),
          pathParam(request.params.targetPluginId),
        ),
      );
    }),
  );

  router.put(
    '/apps/:appId/environments/:environmentId/workspaces/:targetPluginId/grants',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['grants']) || !Array.isArray(request.body.grants)) {
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
        await dependencies.environments.replaceWorkspaceGrants(
          { userId: agentUserId(request), appId: pathParam(request.params.appId) },
          pathParam(request.params.environmentId),
          pathParam(request.params.targetPluginId),
          grants,
        ),
      );
    }),
  );

  router.get(
    '/environments/availability',
    agentRoute(async (request, response) => {
      agentData(request, response, await dependencies.environments.availability());
    }),
  );

  router.get(
    '/environments/catalog',
    agentRoute(async (request, response) => {
      agentData(request, response, await dependencies.environments.catalog());
    }),
  );

  router.get(
    '/environments/storage',
    agentRoute(async (request, response) => {
      agentData(request, response, await dependencies.environments.storage());
    }),
  );

  router.post(
    '/environments/setup/preview',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['recipes', 'expectedVersion']) ||
        !Array.isArray(request.body.recipes) ||
        !positiveInteger(request.body.expectedVersion)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      agentData(
        request,
        response,
        await dependencies.environments.previewSetup(
          agentUserId(request),
          request.body.recipes,
          request.body.expectedVersion,
        ),
      );
    }),
  );

  router.post(
    '/environments/setup/confirm',
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
      agentData(
        request,
        response,
        await dependencies.environments.confirmSetup(
          agentUserId(request),
          request.body.confirmationId,
          request.body.expectedVersion,
        ),
        202,
      );
    }),
  );

  router.post(
    '/environments/packs/:familyId/:versionId/install',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        request.body !== undefined &&
        request.body !== null &&
        (!isRecord(request.body) || Object.keys(request.body).length)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      agentData(
        request,
        response,
        await dependencies.environments.installPack(
          agentUserId(request),
          pathParam(request.params.familyId),
          pathParam(request.params.versionId),
        ),
        202,
      );
    }),
  );

  router.post(
    '/environments/packs/:familyId/:versionId/uninstall/preview',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['expectedVersion']) ||
        !positiveInteger(request.body.expectedVersion)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      agentData(
        request,
        response,
        await dependencies.environments.previewPackUninstall(
          agentUserId(request),
          pathParam(request.params.familyId),
          pathParam(request.params.versionId),
          request.body.expectedVersion,
        ),
      );
    }),
  );

  router.post(
    '/environments/packs/:familyId/:versionId/uninstall/confirm',
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
      agentData(
        request,
        response,
        await dependencies.environments.confirmPackUninstall(
          agentUserId(request),
          request.body.confirmationId,
          request.body.expectedVersion,
        ),
        202,
      );
    }),
  );

  router.post(
    '/environments/runtime-cleanup/preview',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['expectedVersion']) ||
        !positiveInteger(request.body.expectedVersion)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      agentData(
        request,
        response,
        await dependencies.environments.previewRuntimeCleanup(agentUserId(request), request.body.expectedVersion),
      );
    }),
  );

  router.post(
    '/environments/runtime-cleanup/confirm',
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
      agentData(
        request,
        response,
        await dependencies.environments.confirmRuntimeCleanup(
          agentUserId(request),
          request.body.confirmationId,
          request.body.expectedVersion,
        ),
        202,
      );
    }),
  );

  router.post(
    '/environments/settings/reset/preview',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        !isRecord(request.body) ||
        !hasOnlyKeys(request.body, ['expectedVersion']) ||
        !positiveInteger(request.body.expectedVersion)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      agentData(
        request,
        response,
        await dependencies.environments.previewSettingsReset(agentUserId(request), request.body.expectedVersion),
      );
    }),
  );

  router.post(
    '/environments/settings/reset/confirm',
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
      agentData(
        request,
        response,
        await dependencies.environments.confirmSettingsReset(
          agentUserId(request),
          request.body.confirmationId,
          request.body.expectedVersion,
        ),
      );
    }),
  );

  router.get(
    '/environments/commands/:commandId',
    agentRoute(async (request, response) => {
      agentData(
        request,
        response,
        await dependencies.environments.getCommand(
          { userId: agentUserId(request), appId: 'nexus.host' },
          pathParam(request.params.commandId),
        ),
      );
    }),
  );

  router.post(
    '/environments/cache-cleanup',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        request.body !== undefined &&
        request.body !== null &&
        (!isRecord(request.body) || Object.keys(request.body).length)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      agentData(
        request,
        response,
        await dependencies.environments.adminAction(agentUserId(request), 'cacheCleanup', {}),
        202,
      );
    }),
  );

  return router;
};
