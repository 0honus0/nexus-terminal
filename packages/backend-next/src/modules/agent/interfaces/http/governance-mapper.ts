import type { AgentApprovalView } from '@nexus-terminal/shared/agent/governance/model';
import type { Approval } from '../../governance/model/governance-types.js';

export const toApproval = (a: Approval): AgentApprovalView => ({
	id: a.id,
	appId: a.appId,
	runId: a.runId,
	toolCallId: a.toolCallId,
	kind: a.kind,
	operationHash: a.operationHash,
	status: a.status,
	policyRevision: a.policyRevision,
	inputRevision: a.inputRevision,
	version: a.version,
	requestedAt: a.requestedAt,
	expiresAt: a.expiresAt,
	decidedAt: a.decidedAt,
	decidedByUserId: a.decidedByUserId,
	consumedAt: a.consumedAt,
	inspection: {
		toolName: a.inspection.toolName,
		toolVersion: a.inspection.toolVersion,
		risk: a.inspection.risk,
		mutation: a.inspection.mutation,
		targetConnectionId: a.inspection.targetConnectionId,
		summary: a.inspection.summary,
	},
});
