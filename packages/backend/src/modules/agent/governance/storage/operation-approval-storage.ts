import type {
	AgentApprovalRisk,
	AgentApprovalStatus,
	AgentCapability,
} from '@nexus-terminal/shared/agent/governance/values';

export interface StoredOperationApproval {
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

export interface StoredOperationApprovalRequest {
	id: string;
	operationId: string;
	operationHash: string;
	operationRevision: number;
	userId: number;
	appId: string;
	runId: string;
	executionGeneration: string;
	policyRevision: number;
	capability: AgentCapability;
	risk: AgentApprovalRisk;
	summary: string;
	targetId: number | null;
	now: number;
	ttlMs: number;
}

export interface OperationApprovalStorage {
	request(input: StoredOperationApprovalRequest): Promise<StoredOperationApproval>;
	get(userId: number, appId: string, operationId: string, now: number): Promise<StoredOperationApproval | null>;
	getApproval(
		userId: number,
		appId: string,
		approvalId: string,
		now: number,
	): Promise<StoredOperationApproval | null>;
	list(
		userId: number,
		appId: string,
		runId: string,
		before: string | null,
		limit: number,
		now: number,
	): Promise<StoredOperationApproval[]>;
	resolve(
		userId: number,
		digest: string,
		command: StoredOperationApprovalDecision,
		now: number,
	): Promise<StoredOperationApproval>;
}

export interface StoredOperationApprovalDecision {
	appId: string;
	approvalId: string;
	operationKey: string;
	operationHash: string;
	expectedVersion: number;
	decision: 'approved' | 'denied';
	feedback: string | null;
	requestHash: string;
}

export class OperationApprovalRefusal extends Error {
	constructor(
		readonly code: 'not_found' | 'version_conflict' | 'unauthenticated' | 'forbidden' | 'idempotency_conflict',
	) {
		super('Operation approval: ' + code);
		this.name = 'OperationApprovalRefusal';
	}
}
