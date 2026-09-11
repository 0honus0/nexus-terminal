import { Router, type RequestHandler } from 'express';
import type { AgentWorkspaceRuntimeFacade } from '../../../modules/agent/public';
import { agentData, agentRoute } from './agent-http';
import { hasOnlyKeys, isRecord, nonEmptyString, pathParam, positiveInteger } from './agent-route-input';
import { agentUserId } from './agent-security';

export const createWorkspaceRuntimeRouter = (
  workspaceRuntime: AgentWorkspaceRuntimeFacade,
  mutationSecurity: RequestHandler,
): Router => {
  const router = Router();

  router.get(
    '/availability',
    agentRoute(async (request, response) => {
      agentData(request, response, await workspaceRuntime.availability());
    }),
  );

  router.get(
    '/catalog',
    agentRoute(async (request, response) => {
      agentData(request, response, await workspaceRuntime.catalog());
    }),
  );

  router.get(
    '/storage',
    agentRoute(async (request, response) => {
      agentData(request, response, await workspaceRuntime.storage());
    }),
  );

  router.post(
    '/setup/preview',
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
        await workspaceRuntime.previewSetup(agentUserId(request), request.body.recipes, request.body.expectedVersion),
      );
    }),
  );

  router.post(
    '/setup/confirm',
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
        await workspaceRuntime.confirmSetup(
          agentUserId(request),
          request.body.confirmationId,
          request.body.expectedVersion,
        ),
        202,
      );
    }),
  );

  router.post(
    '/tool-packs/:familyId/:versionId/install',
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
        await workspaceRuntime.installPack(
          agentUserId(request),
          pathParam(request.params.familyId),
          pathParam(request.params.versionId),
        ),
        202,
      );
    }),
  );

  router.post(
    '/tool-packs/:familyId/:versionId/uninstall/preview',
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
        await workspaceRuntime.previewPackUninstall(
          agentUserId(request),
          pathParam(request.params.familyId),
          pathParam(request.params.versionId),
          request.body.expectedVersion,
        ),
      );
    }),
  );

  router.post(
    '/tool-packs/:familyId/:versionId/uninstall/confirm',
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
        await workspaceRuntime.confirmPackUninstall(
          agentUserId(request),
          request.body.confirmationId,
          request.body.expectedVersion,
        ),
        202,
      );
    }),
  );

  router.post(
    '/runtime-cleanup/preview',
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
        await workspaceRuntime.previewRuntimeCleanup(agentUserId(request), request.body.expectedVersion),
      );
    }),
  );

  router.post(
    '/runtime-cleanup/confirm',
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
        await workspaceRuntime.confirmRuntimeCleanup(
          agentUserId(request),
          request.body.confirmationId,
          request.body.expectedVersion,
        ),
        202,
      );
    }),
  );

  router.post(
    '/settings/reset/preview',
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
        await workspaceRuntime.previewSettingsReset(agentUserId(request), request.body.expectedVersion),
      );
    }),
  );

  router.post(
    '/settings/reset/confirm',
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
        await workspaceRuntime.confirmSettingsReset(
          agentUserId(request),
          request.body.confirmationId,
          request.body.expectedVersion,
        ),
      );
    }),
  );

  router.get(
    '/commands/:commandId',
    agentRoute(async (request, response) => {
      agentData(
        request,
        response,
        await workspaceRuntime.getCommand(
          { userId: agentUserId(request), appId: 'nexus.host' },
          pathParam(request.params.commandId),
        ),
      );
    }),
  );

  router.post(
    '/cache-cleanup',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (
        request.body !== undefined &&
        request.body !== null &&
        (!isRecord(request.body) || Object.keys(request.body).length)
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      agentData(request, response, await workspaceRuntime.adminAction(agentUserId(request), 'cacheCleanup', {}), 202);
    }),
  );

  return router;
};
