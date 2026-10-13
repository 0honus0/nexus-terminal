import type { AgentProviderFailureCode } from '@nexus-terminal/shared/agent/providers/values';

/** Internal input/use-case failure; independent of persistence and module outputs. */
export class AgentFailure extends Error {
	constructor(
		readonly code:
			| 'invalid_input'
			| 'not_found'
			| 'version_conflict'
			| 'provider_unavailable'
			| 'provider_in_use'
			| 'provider_configuration_stale'
			| 'model_not_found'
			| 'provider_request_failed'
			| 'approval_stale'
			| 'limit_exceeded'
			| 'storage_unavailable'
			| 'operation_unknown'
			| 'internal_failure'
			| 'idempotency_conflict',
		options?: ErrorOptions,
	) {
		super('Agent: ' + code, options);
		this.name = 'AgentFailure';
	}
}

/** Safe application failure translated by Model, not a vendor exception. */
export class ProviderRequestFailure extends AgentFailure {
	constructor(
		readonly errorCode: AgentProviderFailureCode,
		options?: ErrorOptions,
	) {
		super('provider_request_failed', options);
		this.name = 'ProviderRequestFailure';
	}
}

/** Business refusals are expected; persistence and unknown failures remain shutdown evidence. */
export function isAgentDrainFailure(error: unknown): boolean {
	return (
		!(error instanceof AgentFailure) ||
		error.code === 'storage_unavailable' ||
		error.code === 'operation_unknown' ||
		error.code === 'internal_failure'
	);
}
