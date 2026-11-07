import type { AgentOperationErrorCode } from '../values.js';
import type { AgentPluginPackageReference } from './model.js';
import type { AgentPluginRegistrationDefinition } from './registry.js';

/** Reserved SDK dispatch; it never grants a capability bridge or an application registration. */
export const AGENT_PLUGIN_RESOURCE_RELEASE_KEY = 'host.resources.release';

/** Host-issued instance preparation, separate from every user Run and Settings grant. */
export const AGENT_PLUGIN_INSTANCE_PREPARE_KEY = 'host.instance.prepare';

export interface AgentPluginRuntimeContext {
	protocol: 4;
	sdkVersion: '4';
	appId: string;
	instanceId: string;
	generation: string;
	package: AgentPluginPackageReference;
	configurationRevision: number;
}

export type AgentPluginCallScope =
	| { kind: 'run'; runId: string; operationId: string | null; deadlineUnixMs: number }
	| { kind: 'settings'; deadlineUnixMs: number }
	| { kind: 'lifecycle'; deadlineUnixMs: number };

export interface AgentPluginDispatchInput {
	key: string;
	argumentsJson: string;
	scope: AgentPluginCallScope;
}

export type AgentPluginCapabilityReply = { ok: true; valueJson: string } | { ok: false; code: AgentOperationErrorCode };

export interface AgentPluginCapabilityBridge {
	call(input: { method: string; inputJson: string }): Promise<AgentPluginCapabilityReply>;
}

/** Host decodes each known capability's parameters at its actual owner. */
export interface AgentPluginCapabilityRequest {
	method: string;
	inputJson: string;
}

export type AgentPluginDispatchReply = { resultJson: string } | { errorCode: AgentOperationErrorCode };

export interface AgentPluginRuntimeModule {
	activate(input: { context: AgentPluginRuntimeContext }): Promise<AgentPluginRegistrationDefinition[]>;
	dispatch(
		input: AgentPluginDispatchInput,
		bridge: AgentPluginCapabilityBridge,
		signal: AbortSignal,
	): Promise<AgentPluginDispatchReply>;
	health(): boolean | Promise<boolean>;
	quiesce(deadlineUnixMs: number): void | Promise<void>;
	dispose(): void | Promise<void>;
}
