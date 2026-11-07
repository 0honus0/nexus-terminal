import type { AgentApprovalView } from '@nexus-terminal/shared/agent/governance/model';
import type { NativeApproval } from './native-run-types';

export function fromNativeApproval(value: AgentApprovalView): NativeApproval {
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
		requestedAt: value.requestedAt,
		expiresAt: value.expiresAt,
		decidedAt: value.decidedAt,
		decidedByUserId: value.decidedByUserId,
		consumedAt: value.consumedAt,
	};
}
