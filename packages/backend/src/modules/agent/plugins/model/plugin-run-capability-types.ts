import type { RunAppCapabilityFactory } from '../../runs/model/run-app-driver-types.js';
import type { PluginCapabilitySource } from './plugin-run-types.js';
import type { OperationDispatchAuthority } from '../../operations/model/operation-types.js';
import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type { PluginCapabilityRequest, PluginCapabilityReply } from './plugin-invocation-types.js';

export interface PluginRunCapabilityExtension {
	call(
		request: PluginCapabilityRequest,
		source: PluginCapabilitySource,
		signal: AbortSignal,
	): Promise<PluginCapabilityReply>;
	drain(): Promise<void>;
}

export interface PluginRunCapabilityExtensions {
	open(
		input: Parameters<RunAppCapabilityFactory['open']>[0] & {
			authorize(source: PluginCapabilitySource): Promise<OperationDispatchAuthority>;
			visibleCapabilities(source: PluginCapabilitySource): Promise<AgentCapability[]>;
		},
	): PluginRunCapabilityExtension;
}
