import type { AgentPluginRuntimeState } from './runtime-values.js';

export interface AgentPluginRuntimeObservation {
	appId: string;
	instanceId: string;
	revision: number;
	state: AgentPluginRuntimeState;
	updatedAt: number;
	unknownAt: number | null;
	acknowledgedAt: number | null;
}
