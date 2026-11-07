export const AGENT_OPERATION_STATES = [
	'accepted',
	'dispatched',
	'completed',
	'failed',
	'cancelled',
	'unknown',
] as const;

export type AgentOperationState = (typeof AGENT_OPERATION_STATES)[number];

export const AGENT_OPERATION_KINDS = ['model', 'tool', 'effect'] as const;

export type AgentOperationKind = (typeof AGENT_OPERATION_KINDS)[number];
