import type {
  AgentWorkspaceRuntimeConfirmationRequestDto,
  AgentWorkspaceRuntimeEmptyRequestDto,
  AgentWorkspaceRuntimeExpectedVersionRequestDto,
  AgentWorkspaceRuntimeSetupPreviewRequestDto,
} from '@nexus-terminal/protocol/agent-workspace-runtime';
import { Router, type RequestHandler } from 'express';
import type { AgentWorkspaceRuntimeFacade } from '../../../modules/agent/public';
import { agentData, agentRoute } from './agent-http';
import { hasOnlyKeys, isRecord, nonEmptyString, pathParam, positiveInteger } from './agent-route-input';
import { agentUserId } from './agent-security';
import {
  toolchainPackUninstallPreviewDto,
  workspaceRuntimeAvailabilityDto,
  workspaceRuntimeCatalogDto,
  workspaceRuntimeCleanupPreviewDto,
  workspaceRuntimeCommandDto,
  workspaceRuntimeSettingsResetPreviewDto,
  workspaceRuntimeSettingsResetResultDto,
  workspaceRuntimeSetupPreviewDto,
  workspaceRuntimeStorageDto,
} from './workspace-runtime-dto';

const setupPreviewRequest = (value: unknown): AgentWorkspaceRuntimeSetupPreviewRequestDto => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['recipes', 'expectedVersion']) || !Array.isArray(value.recipes)) {
    throw new Error('VALIDATION_FAILED');
  }
  if (!positiveInteger(value.expectedVersion)) throw new Error('VALIDATION_FAILED');
  const recipes = value.recipes.map((candidate) => {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, ['recipeId', 'versions']) ||
      !nonEmptyString(candidate.recipeId)
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    if (candidate.versions !== undefined) {
      if (!isRecord(candidate.versions)) throw new Error('VALIDATION_FAILED');
      for (const [familyId, versionId] of Object.entries(candidate.versions)) {
        if (!familyId || typeof versionId !== 'string' || !versionId) throw new Error('VALIDATION_FAILED');
      }
    }
    return {
      recipeId: candidate.recipeId,
      ...(candidate.versions === undefined ? {} : { versions: candidate.versions as Record<string, string> }),
    };
  });
  return { recipes, expectedVersion: value.expectedVersion };
};

const expectedVersionRequest = (value: unknown): AgentWorkspaceRuntimeExpectedVersionRequestDto => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['expectedVersion']) || !positiveInteger(value.expectedVersion)) {
    throw new Error('VALIDATION_FAILED');
  }
  return { expectedVersion: value.expectedVersion };
};

const confirmationRequest = (value: unknown): AgentWorkspaceRuntimeConfirmationRequestDto => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['confirmationId', 'expectedVersion']) ||
    !nonEmptyString(value.confirmationId) ||
    !positiveInteger(value.expectedVersion)
  ) {
    throw new Error('VALIDATION_FAILED');
  }
  return { confirmationId: value.confirmationId, expectedVersion: value.expectedVersion };
};

const emptyRequest = (value: unknown): AgentWorkspaceRuntimeEmptyRequestDto => {
  if (value !== undefined && value !== null && (!isRecord(value) || Object.keys(value).length)) {
    throw new Error('VALIDATION_FAILED');
  }
  return {};
};

export const createWorkspaceRuntimeRouter = (
  workspaceRuntime: AgentWorkspaceRuntimeFacade,
  mutationSecurity: RequestHandler,
): Router => {
  const router = Router();

  router.get(
    '/availability',
    agentRoute(async (request, response) => {
      agentData(request, response, workspaceRuntimeAvailabilityDto(await workspaceRuntime.availability()));
    }),
  );

  router.get(
    '/catalog',
    agentRoute(async (request, response) => {
      agentData(request, response, workspaceRuntimeCatalogDto(await workspaceRuntime.catalog()));
    }),
  );

  router.get(
    '/storage',
    agentRoute(async (request, response) => {
      agentData(request, response, workspaceRuntimeStorageDto(await workspaceRuntime.storage()));
    }),
  );

  router.post(
    '/setup/preview',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = setupPreviewRequest(request.body);
      agentData(
        request,
        response,
        workspaceRuntimeSetupPreviewDto(
          await workspaceRuntime.previewSetup(agentUserId(request), input.recipes, input.expectedVersion),
        ),
      );
    }),
  );

  router.post(
    '/setup/confirm',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = confirmationRequest(request.body);
      agentData(
        request,
        response,
        workspaceRuntimeCommandDto(
          await workspaceRuntime.confirmSetup(agentUserId(request), input.confirmationId, input.expectedVersion),
        ),
        202,
      );
    }),
  );

  router.post(
    '/tool-packs/:familyId/:versionId/install',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = emptyRequest(request.body);
      void input;
      agentData(
        request,
        response,
        workspaceRuntimeCommandDto(
          await workspaceRuntime.installPack(
            agentUserId(request),
            pathParam(request.params.familyId),
            pathParam(request.params.versionId),
          ),
        ),
        202,
      );
    }),
  );

  router.post(
    '/tool-packs/:familyId/:versionId/uninstall/preview',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = expectedVersionRequest(request.body);
      agentData(
        request,
        response,
        toolchainPackUninstallPreviewDto(
          await workspaceRuntime.previewPackUninstall(
            agentUserId(request),
            pathParam(request.params.familyId),
            pathParam(request.params.versionId),
            input.expectedVersion,
          ),
        ),
      );
    }),
  );

  router.post(
    '/tool-packs/:familyId/:versionId/uninstall/confirm',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = confirmationRequest(request.body);
      agentData(
        request,
        response,
        workspaceRuntimeCommandDto(
          await workspaceRuntime.confirmPackUninstall(
            agentUserId(request),
            input.confirmationId,
            input.expectedVersion,
          ),
        ),
        202,
      );
    }),
  );

  router.post(
    '/runtime-cleanup/preview',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = expectedVersionRequest(request.body);
      agentData(
        request,
        response,
        workspaceRuntimeCleanupPreviewDto(
          await workspaceRuntime.previewRuntimeCleanup(agentUserId(request), input.expectedVersion),
        ),
      );
    }),
  );

  router.post(
    '/runtime-cleanup/confirm',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = confirmationRequest(request.body);
      agentData(
        request,
        response,
        workspaceRuntimeCommandDto(
          await workspaceRuntime.confirmRuntimeCleanup(
            agentUserId(request),
            input.confirmationId,
            input.expectedVersion,
          ),
        ),
        202,
      );
    }),
  );

  router.post(
    '/settings/reset/preview',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = expectedVersionRequest(request.body);
      agentData(
        request,
        response,
        workspaceRuntimeSettingsResetPreviewDto(
          await workspaceRuntime.previewSettingsReset(agentUserId(request), input.expectedVersion),
        ),
      );
    }),
  );

  router.post(
    '/settings/reset/confirm',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = confirmationRequest(request.body);
      agentData(
        request,
        response,
        workspaceRuntimeSettingsResetResultDto(
          await workspaceRuntime.confirmSettingsReset(
            agentUserId(request),
            input.confirmationId,
            input.expectedVersion,
          ),
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
        workspaceRuntimeCommandDto(
          await workspaceRuntime.getCommand(
            { userId: agentUserId(request), appId: 'nexus.host' },
            pathParam(request.params.commandId),
          ),
        ),
      );
    }),
  );

  router.post(
    '/cache-cleanup',
    mutationSecurity,
    agentRoute(async (request, response) => {
      const input = emptyRequest(request.body);
      agentData(
        request,
        response,
        workspaceRuntimeCommandDto(await workspaceRuntime.adminAction(agentUserId(request), 'cacheCleanup', input)),
        202,
      );
    }),
  );

  return router;
};
