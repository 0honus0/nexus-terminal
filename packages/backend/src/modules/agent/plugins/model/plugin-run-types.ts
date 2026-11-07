import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type {
	OperationExecution,
	OperationExecutionResult,
	OperationScope,
} from '../../operations/model/operation-types.js';
import type { OperationDispatchAuthority } from '../../operations/model/operation-types.js';
import type { PluginCallScope, PluginCapabilityRequest, PluginCapabilityReply } from './plugin-invocation-types.js';
import type { RunAppExecution } from '../../runs/model/run-app-execution-types.js';

export interface PluginInvocationParticipant {
	instanceId: string;
	generation: string;
	packageRevision: number;
	packageId: string;
	configurationRevision: number;
}

export interface PluginCapabilitySource {
	packageRevision: number;
	ancestors: readonly PluginInvocationParticipant[];
	instanceId: string;
	generation: string;
	packageId: string;
	operationId: string | null;
	configurationRevision: number;
	capabilities: readonly AgentCapability[];
	pure: boolean;
}

export interface PluginRunInvocation {
	scope: OperationScope;
	execution: Extract<RunAppExecution, { kind: 'plugin' }>;
	inputJson: string;
	deadlineUnixMs: number;
	signal: AbortSignal;
	assertCurrent(): Promise<void>;
	authorize(source: PluginCapabilitySource): Promise<OperationDispatchAuthority>;
	visibleCapabilities(source: PluginCapabilitySource): Promise<AgentCapability[]>;
	visibleToolKeys(): Promise<readonly string[] | null>;
	operation(input: OperationExecution): Promise<OperationExecutionResult>;
	capability(
		input: PluginCapabilityRequest,
		source: PluginCapabilitySource,
		signal: AbortSignal,
	): Promise<PluginCapabilityReply>;
}

export interface PluginRegisteredInvocation {
	/** Catalog metadata follows App authority; actual nested execution remains narrowed by source. */
	catalogSource: PluginCapabilitySource;
	bindingOwners: Set<string>;
	scope: PluginCallScope;
	source: PluginCapabilitySource;
	allowedPackageIds: readonly string[];
	selectedPackageIds: readonly string[];
}
