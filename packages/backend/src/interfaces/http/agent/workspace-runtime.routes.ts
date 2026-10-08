import { Router } from 'express';
import type { AgentWorkspaceRuntimeFacade } from '../../../modules/agent/public';
import { agentData, agentRoute } from './agent-http';
import { workspaceRuntimeAvailabilityDto, workspaceRuntimeCatalogDto } from './workspace-runtime-dto';

export const createWorkspaceRuntimeRouter = (
  workspaceRuntime: Pick<AgentWorkspaceRuntimeFacade, 'availability' | 'catalog'>,
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

  return router;
};
