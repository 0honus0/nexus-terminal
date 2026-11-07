import type { AgentCapability, AgentApprovalRisk } from '@nexus-terminal/shared/agent/governance/values';
import type { AgentToolIdentity } from '@nexus-terminal/shared/agent/tools/identity';

/** Trusted execution policy. Model proposals cannot choose these fields. */
export interface ToolExecutionDefinition {
	name: string;
	version: string;
	identity: AgentToolIdentity;
	capability: AgentCapability;
	risk: AgentApprovalRisk;
	mutation: boolean;
	scheduling: 'parallel' | 'exclusive';
	childAccess: 'inherit' | 'root-only';
	requirements: { capabilities: AgentCapability[]; targets: boolean };
}

/** Host capabilities have execution policy, never a second model interface. */
export type HostOperationDefinition = ToolExecutionDefinition;

export interface ToolConnection {
	id: number;
	version: number;
	type: import('@nexus-terminal/shared/targets/connections/values').ConnectionType;
	name: string;
	host: string;
	port: number;
	username: string;
}

export interface ToolTarget {
	id: number;
	version: number;
	fingerprint: string;
}

export interface ToolOperationScope {
	operationId: string;
	timeoutMs: number;
	target: ToolTarget;
	signal: AbortSignal;
	validate(): Promise<void>;
}

export interface ToolJobControlInput {
	action: 'list' | 'status' | 'wait' | 'cancel' | 'output';
	jobIds: string[];
	waitMode: 'all' | 'any';
	waitSeconds: number;
	offset: number;
}

export interface ToolFileContent {
	name: string;
	sizeBytes: number;
}
