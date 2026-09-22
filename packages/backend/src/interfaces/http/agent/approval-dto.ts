import type {
  AgentApprovalViewDto,
  AgentToolInspectionDto,
  AgentToolTargetDto,
} from '@nexus-terminal/protocol/agent-approvals';
import type { AgentApprovalFacade } from '../../../modules/agent/public';

type ApprovalView = Awaited<ReturnType<AgentApprovalFacade['get']>>;
type ToolTarget = ApprovalView['inspection']['target'];

const toolTargetDto = (target: ToolTarget): AgentToolTargetDto => {
  const base = {
    targetIdentity: target.targetIdentity,
    endpoint: target.endpoint,
    loginUser: target.loginUser,
    configurationHash: target.configurationHash,
    ...(target.connectionId === undefined ? {} : { connectionId: target.connectionId }),
    ...(target.workspaceId === undefined ? {} : { workspaceId: target.workspaceId }),
    ...(target.integrationId === undefined ? {} : { integrationId: target.integrationId }),
    ...(target.schemaHash === undefined ? {} : { schemaHash: target.schemaHash }),
    ...(target.browserSessionId === undefined ? {} : { browserSessionId: target.browserSessionId }),
    ...(target.snapshotId === undefined ? {} : { snapshotId: target.snapshotId }),
    ...(target.generation === undefined ? {} : { generation: target.generation }),
    ...(target.hostKeyTrust === undefined ? {} : { hostKeyTrust: target.hostKeyTrust }),
  };
  if ('target' in target) {
    return { ...base, kind: target.kind, target: target.target, id: target.id };
  }
  return { ...base, kind: target.kind };
};

const toolInspectionDto = (inspection: ApprovalView['inspection']): AgentToolInspectionDto => ({
  toolName: inspection.toolName,
  toolVersion: inspection.toolVersion,
  normalizedArguments: inspection.normalizedArguments,
  target: toolTargetDto(inspection.target),
  resourceKeys: [...inspection.resourceKeys],
  risk: inspection.risk,
  mutation: inspection.mutation,
  operationHash: inspection.operationHash,
  operationHashVersion: 1,
  preconditions: inspection.preconditions.map((precondition) => ({
    kind: precondition.kind,
    key: precondition.key,
    observedValue: precondition.observedValue,
  })),
  policyRevision: inspection.policyRevision,
  inputRevision: inspection.inputRevision,
});

export const approvalDto = (approval: ApprovalView): AgentApprovalViewDto => ({
  id: approval.id,
  userId: approval.userId,
  appId: approval.appId,
  runId: approval.runId,
  toolCallId: approval.toolCallId,
  requestedByRuntimeId: approval.requestedByRuntimeId,
  operationHash: approval.operationHash,
  operationHashVersion: 1,
  kind: approval.kind,
  status: approval.status,
  policyRevision: approval.policyRevision,
  inputRevision: approval.inputRevision,
  decidedByUserId: approval.decidedByUserId,
  decidedAt: approval.decidedAt,
  consumedAt: approval.consumedAt,
  requestedAt: approval.requestedAt,
  expiresAt: approval.expiresAt,
  version: approval.version,
  inspection: toolInspectionDto(approval.inspection),
});
