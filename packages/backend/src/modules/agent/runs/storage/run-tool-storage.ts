import type { AgentToolIdentity } from '@nexus-terminal/shared/agent/tools/identity';
import type { AgentRunFailureCode } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentToolState } from '@nexus-terminal/shared/agent/tools/values';
import type { AgentApprovalRisk, AgentCapability } from '@nexus-terminal/shared/agent/governance/values';

/** No application objects cross the journal boundary. Arguments and results stay private. */
export interface StoredToolOperation {
	id: string;
	userId: number;
	appId: string;
	runId: string;
	modelStepIndex: number;
	providerCallId: string;
	toolName: string;
	toolVersion: string;
	identity: AgentToolIdentity;
	capability: AgentCapability;
	requiredCapabilities: AgentCapability[];
	targetId: number | null;
	targetVersion: number | null;
	risk: AgentApprovalRisk;
	mutation: boolean;
	summary: string;
	argumentsJson: string;
	operationHash: string;
	operationRevision: number;
	revision: number;
	state: AgentToolState;
	/** App-owned file delivered by a completed, server-owned output tool. */
	outputArtifactIds: string[];
	resultText: string | null;
	failureCode: AgentRunFailureCode | null;
	createdAt: number;
	updatedAt: number;
}

export interface StoredToolEvent {
	toolCallId: string;
	runId: string;
	revision: number;
	operationRevision: number;
	state: AgentToolState;
	operationHash: string;
	createdAt: number;
}

export type StoredToolChildRelation = {
	toolId: string;
	parentId: string;
	parentHash: string;
	requestKey: string;
} & (
	| { kind: 'acp_permission'; plugin: null }
	| {
			kind: 'plugin_tool';
			plugin: {
				packageId: string;
				installationRevision: number;
				instanceId: string;
				instanceRevision: number;
			};
	  }
);
