import type {
	AgentPluginDispatchInput,
	AgentPluginCapabilityReply,
	AgentPluginCapabilityRequest,
} from '@nexus-terminal/shared/agent/plugins/runtime';
import type { AgentPluginRegistrationDefinition } from '@nexus-terminal/shared/agent/plugins/registry';

export interface PluginBackendInstance {
	readonly exited: Promise<void>;
	activate(): Promise<AgentPluginRegistrationDefinition[]>;
	releaseResources(runId: string, deadlineUnixMs: number): Promise<void>;
	invokeCallable(
		input: AgentPluginDispatchInput,
		signal: AbortSignal,
		timeoutMs: number,
		call: (input: AgentPluginCapabilityRequest) => Promise<AgentPluginCapabilityReply>,
	): Promise<string>;
	health(): Promise<boolean>;
	quiesce(deadline: number): Promise<void>;
	close(): Promise<void>;
}

export interface PluginBackendRuntime {
	recover(): Promise<void>;
	open(input: {
		appId: string;
		instanceId: string;
		generation: string;
		definitionId: string;
		packageHash: string;
		publisherKeyId: string;
		version: string;
		configurationRevision: number;
		entry: string;
		files: { path: string; bytes: Uint8Array; sha256: string }[];
	}): Promise<PluginBackendInstance>;
}

/** A completed SDK dispatch refused the call; it does not describe any child effect. */
export class PluginCallableRefusal extends Error {
	constructor(readonly code: import('@nexus-terminal/shared/agent/values').AgentOperationErrorCode) {
		super(code);
		this.name = 'PluginCallableRefusal';
	}
}
