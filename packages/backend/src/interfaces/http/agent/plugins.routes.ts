import type {
  AgentPluginArtifactStageRequestDto,
  AgentPluginDeleteDataRequestDto,
  AgentPluginDeleteDataResponseDto,
  AgentPluginFrontendRpcRequestDto,
  AgentPluginFrontendRpcResponseDto,
  AgentPluginOfficialStageRequestDto,
  AgentPluginRemoteCatalogQueryDto,
  AgentPluginRemoteStageRequestDto,
  AgentPluginRevokePublisherResponseDto,
  AgentPluginStageIdRequestDto,
  AgentPluginTrustPublisherRequestDto,
  AgentPluginUninstallRequestDto,
  AgentPluginUpgradeRequestDto,
  AgentPluginVersionsQueryDto,
} from '@nexus-terminal/protocol/agent-plugins';
import { Router, type RequestHandler } from 'express';
import type { AgentPluginFacade } from '../../../modules/agent/public';
import { agentData, agentError, agentRoute } from './agent-http';
import {
  pluginFrontendDescriptorDto,
  pluginInstallResultDto,
  pluginInstallationDto,
  pluginPublisherDto,
  pluginStageDto,
  pluginUninstallResultDto,
  pluginUpgradeResultDto,
  pluginVerifyResultDto,
  pluginVersionDto,
  remotePluginCatalogDto,
} from './plugin-dto';
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
      agentData(request, response, keys.map(pluginPublisherDto));
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
      const input: AgentPluginTrustPublisherRequestDto = {
        publicKeyPem: request.body.publicKeyPem,
        label: request.body.label,
      };
      const key = await plugins.trustPublisherKey(agentUserId(request), input.publicKeyPem, input.label);
      agentData(request, response, pluginPublisherDto(key), 201);
    }),
  );

  router.delete(
    '/publishers/:keyId',
    mutationSecurity,
    agentRoute(async (request, response) => {
      await plugins.revokePublisherKey(agentUserId(request), pathParam(request.params.keyId));
      const payload: AgentPluginRevokePublisherResponseDto = { revoked: true };
      agentData(request, response, payload);
    }),
  );

  router.get(
    '/installations',
    agentRoute(async (request, response) => {
      agentData(request, response, (await plugins.listInstallations(agentUserId(request))).map(pluginInstallationDto));
    }),
  );

  router.get(
    '/versions',
    agentRoute(async (request, response) => {
      const appId = queryString(request.query.appId);
      const query: AgentPluginVersionsQueryDto = appId === undefined ? {} : { appId };
      agentData(
        request,
        response,
        (await plugins.listVersions(agentUserId(request), query.appId)).map(pluginVersionDto),
      );
    }),
  );

  router.get(
    '/official/catalog',
    agentRoute(async (request, response) => {
      agentData(request, response, remotePluginCatalogDto(await plugins.officialCatalog(AbortSignal.timeout(30_000))));
    }),
  );

  router.post(
    '/official/stage',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['appId', 'version'])) {
        throw new Error('VALIDATION_FAILED');
      }
      if (!nonEmptyString(request.body.appId) || !nonEmptyString(request.body.version)) {
        throw new Error('VALIDATION_FAILED');
      }
      const input: AgentPluginOfficialStageRequestDto = { appId: request.body.appId, version: request.body.version };
      agentData(
        request,
        response,
        pluginStageDto(
          await plugins.stageOfficial(agentUserId(request), input.appId, input.version, AbortSignal.timeout(120_000)),
        ),
        201,
      );
    }),
  );

  router.get(
    '/remote/catalog',
    agentRoute(async (request, response) => {
      const repositoryUrl = queryString(request.query.repositoryUrl);
      if (!repositoryUrl) throw new Error('VALIDATION_FAILED');
      const query: AgentPluginRemoteCatalogQueryDto = { repositoryUrl };
      agentData(
        request,
        response,
        remotePluginCatalogDto(
          await plugins.remoteCatalog(agentUserId(request), query.repositoryUrl, AbortSignal.timeout(30_000)),
        ),
      );
    }),
  );

  router.post(
    '/remote/stage',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['repositoryUrl', 'appId', 'version'])) {
        throw new Error('VALIDATION_FAILED');
      }
      if (
        !nonEmptyString(request.body.repositoryUrl) ||
        !nonEmptyString(request.body.appId) ||
        !nonEmptyString(request.body.version)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const input: AgentPluginRemoteStageRequestDto = {
        repositoryUrl: request.body.repositoryUrl,
        appId: request.body.appId,
        version: request.body.version,
      };
      agentData(
        request,
        response,
        pluginStageDto(await plugins.stageRemote(agentUserId(request), input, AbortSignal.timeout(120_000))),
        201,
      );
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
      const input: AgentPluginArtifactStageRequestDto = {
        artifactRef: { appId: artifactRef.appId, id: artifactRef.id },
      };
      agentData(
        request,
        response,
        pluginStageDto(
          await plugins.stage(agentUserId(request), {
            artifactAppId: input.artifactRef.appId,
            artifactId: input.artifactRef.id,
          }),
        ),
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
      const input: AgentPluginStageIdRequestDto = { stageId: request.body.stageId };
      agentData(request, response, pluginVerifyResultDto(await plugins.verify(agentUserId(request), input.stageId)));
    }),
  );

  router.post(
    '/install',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['stageId']) || !nonEmptyString(request.body.stageId)) {
        throw new Error('VALIDATION_FAILED');
      }
      const input: AgentPluginStageIdRequestDto = { stageId: request.body.stageId };
      agentData(
        request,
        response,
        pluginInstallResultDto(await plugins.install(agentUserId(request), input.stageId)),
        201,
      );
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
      agentData(request, response, pluginFrontendDescriptorDto(descriptor));
    }),
  );

  router.post(
    '/:appId/frontend/rpc',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['version', 'method', 'params', 'operationId']))
        throw new Error('VALIDATION_FAILED');
      if (
        !nonEmptyString(request.body.version) ||
        ![
          'host.appInfo',
          'storage.get',
          'storage.put',
          'storage.delete',
          'intents.create',
          'intents.listReceived',
          'intents.revoke',
          'intents.artifacts.get',
        ].includes(String(request.body.method)) ||
        !Object.prototype.hasOwnProperty.call(request.body, 'params') ||
        !isJsonValue(request.body.params)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const input: AgentPluginFrontendRpcRequestDto = {
        version: request.body.version,
        method: request.body.method as AgentPluginFrontendRpcRequestDto['method'],
        params: request.body.params,
        ...(typeof request.body.operationId === 'string' ? { operationId: request.body.operationId } : {}),
      };
      const payload: AgentPluginFrontendRpcResponseDto = await plugins.frontendRpc(
        agentUserId(request),
        pathParam(request.params.appId),
        input,
      );
      agentData(request, response, payload);
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
      const input: AgentPluginUpgradeRequestDto = {
        stageId: request.body.stageId,
        expectedVersion: request.body.expectedVersion,
      };
      const result = await plugins.upgrade(
        agentUserId(request),
        pathParam(request.params.appId),
        input.stageId,
        input.expectedVersion,
      );
      agentData(request, response, pluginUpgradeResultDto(result), result.state === 'draining' ? 202 : 200);
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
      const input: AgentPluginUninstallRequestDto = {
        deleteData: false,
        expectedVersion: request.body.expectedVersion,
      };
      const result = await plugins.uninstall(
        agentUserId(request),
        pathParam(request.params.appId),
        input.expectedVersion,
      );
      agentData(request, response, pluginUninstallResultDto(result), result.state === 'draining' ? 202 : 200);
    }),
  );

  router.post(
    '/:appId/delete-data',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body) || !hasOnlyKeys(request.body, ['confirmed']) || request.body.confirmed !== true) {
        throw new Error('VALIDATION_FAILED');
      }
      const input: AgentPluginDeleteDataRequestDto = { confirmed: true };
      void input;
      await plugins.deleteData(agentUserId(request), pathParam(request.params.appId));
      const payload: AgentPluginDeleteDataResponseDto = { deleted: true };
      agentData(request, response, payload);
    }),
  );

  return router;
};
