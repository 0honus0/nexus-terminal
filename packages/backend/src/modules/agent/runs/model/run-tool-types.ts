import type { AgentPluginHostOperationName } from '@nexus-terminal/shared/agent/plugins/values';
import type { AgentToolIdentity } from '@nexus-terminal/shared/agent/tools/identity';
import type { AgentRunFailureCode } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentToolState } from '@nexus-terminal/shared/agent/tools/values';
import type { AgentApprovalRisk, AgentCapability } from '@nexus-terminal/shared/agent/governance/values';

export interface ToolOperation {
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

export interface ToolInspectionCommand {
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
	/** Null means a new proposal; replacing content requires an explicit CAS. */
	expectedOperationRevision: number | null;
}

export interface ToolIdentity {
	userId: number;
	appId: string;
	runId: string;
	id: string;
}

export interface ToolSettlement {
	identity: ToolIdentity;
	expectedRevision: number;
	state: 'completed' | 'failed' | 'unknown' | 'cancelled';
	outputArtifactIds: string[];
	resultText: string | null;
}

export interface ToolListCursor {
	createdAt: number;
	id: string;
}

export interface ToolListPage {
	items: ToolOperation[];
	/** Oldest cursor in this page; null when no older records remain. */
	nextCursor: ToolListCursor | null;
}

export interface ToolPermissionInspection {
	parent: ToolIdentity;
	inspection: ToolInspectionCommand;
	maxPermissions: number;
}

/** The exact backend instance that requested a managed host operation. */
export interface ToolInvocationBinding {
	packageId: string;
	installationRevision: number;
	instanceId: string;
	instanceRevision: number;
}

/** Transient proof from the exact managed source invocation, never supplied by package code. */
export interface ManagedToolCancellation {
	identity: ToolIdentity;
	operationHash: string;
	dispatchedRevision: number;
	binding: ToolInvocationBinding;
}

export interface ToolChildInspection {
	parent: ToolIdentity;
	parentHash: string;
	inspection: ToolInspectionCommand;
	binding: ToolInvocationBinding;
}

/** Persisted Host provenance for captured result reauthorization; never includes its private text. */
export interface ToolResultSourceAuthority {
	id: string;
	userId: number;
	appId: string;
	runId: string;
	identity: AgentToolIdentity;
	operationHash: string;
	revision: number;
	toolName: string;
	toolVersion: string;
	capability: AgentCapability;
	requiredCapabilities: AgentCapability[];
	targetId: number | null;
	targetVersion: number | null;
	risk: AgentApprovalRisk;
	mutation: boolean;
}

/** Trusted Host output evidence, not an operation-state mutation or an execution request. */
export interface ToolOutputEvidence {
	identity: ToolIdentity;
	operationHash: string;
	operation: AgentPluginHostOperationName;
	outputArtifactIds: string[];
}
