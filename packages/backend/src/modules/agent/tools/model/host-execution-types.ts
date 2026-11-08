import type { ExecutionLimits } from '../../execution/model/execution-types.js';
import type { ToolCatalogFacts } from '../../governance/model/governance-types.js';
import type { HostOperationResult } from './host-operation-result.js';
import type { ToolTarget, HostOperationDefinition } from './tool-types.js';
import type { AgentApprovalRisk } from '@nexus-terminal/shared/agent/governance/values';

/** Real native effect identity; it has no model-step or provider-call dependency. */
export interface HostEffect {
	id: string;
	userId: number;
	appId: string;
	runId: string;
	executionGeneration: string;
	operationHash: string;
}

export interface HostEffectResult {
	text: string;
	hostResult: HostOperationResult;
	targets: { id: number; version: number }[];
	outputArtifactIds?: string[];
}

export interface HostPluginConfiguration {
	instanceId: string;
	generation: string;
	read(): Promise<{ revision: number; documentJson: string }>;
}

export interface HostEffectContext {
	pluginConfiguration: HostPluginConfiguration;
	operation: HostEffect;
	revision: number;
	signal: AbortSignal;
	limits: ExecutionLimits;
	validate(): Promise<void>;
	recordOutputArtifacts(ids: readonly string[]): void;
	verify(signal: AbortSignal): Promise<ToolCatalogFacts>;
	availableTools(): Promise<string[]>;
	run: {
		signal: AbortSignal;
		deadlineAt: number;
		onBackgroundFailure(error: unknown): void;
	};
}

export interface HostPreparationScope {
	userId: number;
	appId: string;
	runId: string;
	deadlineAt: number;
}

/** Scope for metadata reads: no effect identity is created for a catalogue lookup. */
export interface HostMetadataContext {
	pluginConfiguration: HostPluginConfiguration;
	userId: number;
	appId: string;
	signal: AbortSignal;
	verify(): Promise<ToolCatalogFacts>;
}

export interface PreparedHostEffect {
	target: ToolTarget | null;
	summary: string;
	risk: AgentApprovalRisk;
	mutation: boolean;
	lifetime: 'operation' | 'run';
	refusalIsDefinite?: boolean;
	validate(): Promise<void>;
	execute(context: HostEffectContext): Promise<HostEffectResult>;
	afterCommit?(operation: HostEffect): void;
}

export interface HostEffectContribution {
	definition: HostOperationDefinition;
	prepare(argumentsJson: string, scope: HostPreparationScope, signal: AbortSignal): Promise<PreparedHostEffect>;
}
