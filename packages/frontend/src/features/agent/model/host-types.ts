import type { AgentAppExecutionState } from '@nexus-terminal/shared/agent/scope/values';

/** CAS version and executable package version are deliberately separate. */
export interface HostApp {
	id: string;
	displayName: string;
	definitionId: string;
	version: number;
	packageVersion: string;
	enabled: boolean;
	executionState: AgentAppExecutionState;
	surface: 'agent' | 'custom' | 'unavailable';
}

export interface HostDirectory {
	apps: HostApp[];
	executionEnabled: boolean;
}
