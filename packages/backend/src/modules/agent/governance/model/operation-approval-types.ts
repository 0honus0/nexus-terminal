import type {
	AgentApprovalRisk,
	AgentApprovalStatus,
	AgentCapability,
} from '@nexus-terminal/shared/agent/governance/values';
import type { OperationReceipt } from '../../operations/model/operation-types.js';

export interface OperationApproval {
	id: string;
	sequence: number;
	appId: string;
	runId: string;
	operationId: string;
	parentOperationId: string | null;
	operationName: string;
	operationHash: string;
	policyRevision: number;
	status: AgentApprovalStatus;
	version: number;
	capability: AgentCapability;
	risk: AgentApprovalRisk;
	summary: string;
	targetId: number | null;
	requestedAt: number;
	expiresAt: number;
	decidedAt: number | null;
	decidedBy: number | null;
	consumedAt: number | null;
}

export interface OperationApprovalRequest {
	operation: OperationReceipt;
	policyRevision: number;
	capability: AgentCapability;
	risk: AgentApprovalRisk;
	summary: string;
	targetId: number | null;
}

export interface OperationApprovalActor {
	userId: number;
	token: string;
}

export interface OperationApprovalDecision {
	appId: string;
	approvalId: string;
	operationKey: string;
	operationHash: string;
	expectedVersion: number;
	decision: 'approved' | 'denied';
	feedback?: string;
}

export interface OperationApprovalPage {
	items: OperationApproval[];
	after: string | null;
	nextCursor: string | null;
	hasMore: boolean;
}
