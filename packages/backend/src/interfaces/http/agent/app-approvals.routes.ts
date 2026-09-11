import { Router } from 'express';
import type { AgentApprovalFacade } from '../../../modules/agent/public';
import { agentData, agentRoute } from './agent-http';
import { withVersionConflictDetails } from './agent-route-input';
import { parseApprovalResolveRequest } from './agent-runtime-route-input';
import { agentUserId, createAgentMutationSecurity, requireAgentAuthenticated } from './agent-security';

export interface AppApprovalsRouterDependencies {
  approvals: AgentApprovalFacade;
  nodeEnv: string;
  publicOrigin?: string;
  csrfSecret: string;
}

const pathParam = (value: string | string[] | undefined): string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) throw new Error('VALIDATION_FAILED');
  return value;
};

const idempotencyKey = (value: string | undefined): string => {
  if (!value) throw new Error('IDEMPOTENCY_KEY_INVALID');
  return value;
};

export const createAppApprovalsRouter = (dependencies: AppApprovalsRouterDependencies): Router => {
  const router = Router({ mergeParams: true });
  const mutationSecurity = createAgentMutationSecurity({
    nodeEnv: dependencies.nodeEnv,
    publicOrigin: dependencies.publicOrigin,
    csrfSecret: dependencies.csrfSecret,
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
      const body = parseApprovalResolveRequest(request.body);
      const userId = agentUserId(request);
      const scope = { userId, appId: pathParam(request.params.appId) };
      const approvalId = pathParam(request.params.approvalId);
      const approval = await withVersionConflictDetails(
        body.expectedVersion,
        async () => (await dependencies.approvals.get(scope, approvalId)).version,
        () =>
          dependencies.approvals.resolve(
            scope,
            approvalId,
            body.decision,
            body.operationHash,
            body.expectedVersion,
            userId,
            idempotencyKey(request.header('idempotency-key')),
          ),
        ['STATE_CONFLICT', 'APPROVAL_STALE'],
      );
      agentData(request, response, approval);
    }),
  );

  return router;
};
