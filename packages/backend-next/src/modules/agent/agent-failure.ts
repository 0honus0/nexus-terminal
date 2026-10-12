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
			| 'provider_request_failed',
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
