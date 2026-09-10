import { Router } from 'express';
import type { AgentApprovalFacade } from '../../../modules/agent/public';
import { agentData, agentRoute } from './agent-http';
import { agentUserId, createAgentMutationSecurity, requireAgentAuthenticated } from './agent-security';

export interface AppApprovalsRouterDependencies {
  approvals: AgentApprovalFacade;
  nodeEnv: string;
  publicOrigin?: string;
}

const pathParam = (value: string | string[] | undefined): string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) throw new Error('VALIDATION_FAILED');
  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const idempotencyKey = (value: string | undefined): string => {
  if (!value) throw new Error('IDEMPOTENCY_KEY_INVALID');
  return value;
};

export const createAppApprovalsRouter = (dependencies: AppApprovalsRouterDependencies): Router => {
  const router = Router({ mergeParams: true });
  const mutationSecurity = createAgentMutationSecurity({
    nodeEnv: dependencies.nodeEnv,
    publicOrigin: dependencies.publicOrigin,
  });

  router.use(requireAgentAuthenticated);

  router.get(
    '/:approvalId',
    agentRoute(async (request, response) => {
      const scope = { userId: agentUserId(request), appId: pathParam(request.params.appId) };
      agentData(request, response, await dependencies.approvals.get(scope, pathParam(request.params.approvalId)));
    }),
  );

  router.post(
    '/:approvalId/resolve',
    mutationSecurity,
    agentRoute(async (request, response) => {
      if (!isRecord(request.body)) throw new Error('VALIDATION_FAILED');
      const body = request.body;
      if (
        Object.keys(body).some((key) => !['decision', 'operationHash', 'expectedVersion'].includes(key)) ||
        (body.decision !== 'approved' && body.decision !== 'denied') ||
        typeof body.operationHash !== 'string' ||
        !/^v1:[a-f0-9]{64}$/.test(body.operationHash) ||
        !Number.isSafeInteger(body.expectedVersion) ||
        (body.expectedVersion as number) < 1
      ) {
        throw new Error('VALIDATION_FAILED');
      }
      const userId = agentUserId(request);
      const scope = { userId, appId: pathParam(request.params.appId) };
      agentData(
        request,
        response,
        await dependencies.approvals.resolve(
          scope,
          pathParam(request.params.approvalId),
          body.decision,
          body.operationHash,
          body.expectedVersion as number,
          userId,
          idempotencyKey(request.header('idempotency-key')),
        ),
      );
    }),
  );

  return router;
};
