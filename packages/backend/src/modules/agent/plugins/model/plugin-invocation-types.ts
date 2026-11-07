import type { AgentOperationErrorCode } from '@nexus-terminal/shared/agent/values';

export type PluginCallScope =
	| { kind: 'run'; runId: string; operationId: string | null; deadlineUnixMs: number }
	| { kind: 'settings'; deadlineUnixMs: number }
	| { kind: 'lifecycle'; deadlineUnixMs: number };

export interface PluginCallableInput {
	key: string;
	argumentsJson: string;
	scope: PluginCallScope;
}

export interface PluginCapabilityRequest {
	method: string;
	inputJson: string;
}

export type PluginCapabilityReply = { ok: true; valueJson: string } | { ok: false; code: AgentOperationErrorCode };
