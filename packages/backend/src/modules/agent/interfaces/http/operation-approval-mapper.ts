import type { AgentApprovalView, AgentApprovalPage } from '@nexus-terminal/shared/agent/governance/model';
import type { OperationApproval, OperationApprovalPage } from '../../governance/model/operation-approval-types.js';

export function toOperationApproval(value: OperationApproval): AgentApprovalView {
	return {
		id: value.id,
		sequence: value.sequence,
		appId: value.appId,
		runId: value.runId,
		operationId: value.operationId,
		parentOperationId: value.parentOperationId,
		operationHash: value.operationHash,
		status: value.status,
		policyRevision: value.policyRevision,
		version: value.version,
		capability: value.capability,
		operationName: value.operationName,
		risk: value.risk,
		summary: value.summary,
		targetId: value.targetId,
		requestedAt: Math.floor(value.requestedAt / 1000),
		expiresAt: Math.floor(value.expiresAt / 1000),
		decidedAt: value.decidedAt === null ? null : Math.floor(value.decidedAt / 1000),
		decidedByUserId: value.decidedBy,
		consumedAt: value.consumedAt === null ? null : Math.floor(value.consumedAt / 1000),
	};
}

export function toOperationApprovalPage(value: OperationApprovalPage): AgentApprovalPage {
	return {
		items: value.items.map(toOperationApproval),
		after: value.after,
		nextCursor: value.nextCursor,
		hasMore: value.hasMore,
	};
}
