import type { AgentToolIdentity } from '@nexus-terminal/shared/agent/tools/identity';
import type { AgentApprovalRisk, AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type { StoredOperation } from './operation-storage.js';

export interface StoredOperationActivity {
	operation: StoredOperation;
	revision: number;
	updatedAt: number;
	identity: AgentToolIdentity;
	name: string;
	version: string;
	summary: string;
	capability: AgentCapability;
	risk: AgentApprovalRisk;
	mutation: boolean;
	target: { id: number; version: number } | null;
	effects: { id: string; requestHash: string }[];
	outputArtifactIds: string[];
}

export interface OperationActivityStorage {
	list(
		userId: number,
		appId: string,
		threadId: string,
		before: { createdAt: number; id: string } | null,
		limit: number,
	): Promise<{ items: StoredOperationActivity[]; hasMore: boolean } | null>;
	get(userId: number, appId: string, runId: string, id: string): Promise<StoredOperationActivity | null>;
}
