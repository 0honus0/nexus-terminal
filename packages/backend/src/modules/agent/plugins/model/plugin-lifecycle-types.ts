import type { PluginCapabilityReply, PluginCapabilityRequest } from './plugin-invocation-types.js';
import type { PluginManifest } from './plugin-types.js';

export interface PluginLifecycleInput {
	userId: number;
	appId: string;
	instanceId: string;
	generation: string;
	configurationRevision: number;
	manifest: PluginManifest;
	signal: AbortSignal;
	/** Original reserved incarnation, current package trust, configuration and enabled App. */
	validate(): Promise<void>;
}

export interface PluginLifecycleLease {
	call(request: PluginCapabilityRequest): Promise<PluginCapabilityReply>;
	close(): Promise<void>;
}

export interface PluginLifecycleFactory {
	open(input: PluginLifecycleInput): PluginLifecycleLease;
}
