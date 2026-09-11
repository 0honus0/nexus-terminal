import { Router, type RequestHandler } from 'express';
import type { AgentPluginFacade } from '../../../modules/agent/public';
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
import { agentUserId } from './agent-security';

export const createPluginRouter = (plugins: AgentPluginFacade, mutationSecurity: RequestHandler): Router => {
  const router = Router();

  router.get(
    '/publishers',
    agentRoute(async (request, response) => {
      const keys = await plugins.listPublisherKeys(agentUserId(request));
      agentData(
        request,
        response,
        keys.map(({ publicKeyPem: _publicKeyPem, ...key }) => key),
      );
    }),
  );

  router.post(
    '/publishers',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['publicKeyPem', 'label']))
        throw new Error('VALIDATION_FAILED');
      if (!nonEmptyString(request.body.publicKeyPem) || !nonEmptyString(request.body.label))
        throw new Error('VALIDATION_FAILED');
      const key = await plugins.trustPublisherKey(agentUserId(request), request.body.publicKeyPem, request.body.label);
      const { publicKeyPem: _publicKeyPem, ...view } = key;
      agentData(request, response, view, 201);
    }),
  );

  router.delete(
    '/publishers/:keyId',
    mutationSecurity,
    agentRoute(async (request, response) => {
      await plugins.revokePublisherKey(agentUserId(request), pathParam(request.params.keyId));
      agentData(request, response, { revoked: true });
    }),
  );

  router.get(
    '/installations',
    agentRoute(async (request, response) => {
      agentData(request, response, await plugins.listInstallations(agentUserId(request)));
    }),
  );

  router.get(
    '/versions',
    agentRoute(async (request, response) => {
      const appId = queryString(request.query.appId);
      agentData(request, response, await plugins.listVersions(agentUserId(request), appId));
    }),
  );

  router.post(
    '/stage',
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
        await plugins.stage(agentUserId(request), {
          artifactAppId: artifactRef.appId,
          artifactId: artifactRef.id,
        }),
        201,
      );
    }),
  );

  router.post(
    '/verify',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['stageId']) || !nonEmptyString(request.body.stageId)) {
        throw new Error('VALIDATION_FAILED');
      }
      agentData(request, response, await plugins.verify(agentUserId(request), request.body.stageId));
    }),
  );

  router.post(
    '/install',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['stageId']) || !nonEmptyString(request.body.stageId)) {
        throw new Error('VALIDATION_FAILED');
      }
      agentData(request, response, await plugins.install(agentUserId(request), request.body.stageId), 201);
    }),
  );

  router.get(
    '/:appId/frontend',
    agentRoute(async (request, response) => {
      const descriptor = await plugins.frontendDescriptor(agentUserId(request), pathParam(request.params.appId));
      if (!descriptor) {
        agentError(request, response, 404, 'NOT_FOUND', 'Plugin UI is not available.');
        return;
      }
      agentData(request, response, descriptor);
    }),
  );

  router.post(
    '/:appId/frontend/rpc',
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
        await plugins.frontendRpc(agentUserId(request), pathParam(request.params.appId), {
          method: request.body.method as 'host.appInfo' | 'storage.get' | 'storage.put' | 'storage.delete',
          params: request.body.params,
        }),
      );
    }),
  );

  router.post(
    '/:appId/upgrade',
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
      const result = await plugins.upgrade(
        agentUserId(request),
        pathParam(request.params.appId),
        request.body.stageId,
        request.body.expectedVersion,
      );
      agentData(request, response, result, result.state === 'draining' ? 202 : 200);
    }),
  );

  router.post(
    '/:appId/uninstall',
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
      const result = await plugins.uninstall(
        agentUserId(request),
        pathParam(request.params.appId),
        request.body.expectedVersion,
      );
      agentData(request, response, result, result.state === 'draining' ? 202 : 200);
    }),
  );

  router.post(
    '/:appId/delete-data',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['confirmed']) || request.body.confirmed !== true) {
        throw new Error('VALIDATION_FAILED');
      }
      await plugins.deleteData(agentUserId(request), pathParam(request.params.appId));
      agentData(request, response, { deleted: true });
    }),
  );

  return router;
};
