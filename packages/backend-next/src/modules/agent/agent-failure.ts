import type { AgentOperationErrorCode } from '@nexus-terminal/shared/agent/values';
import type { AgentProviderFailureCode } from '@nexus-terminal/shared/agent/providers/values';

/** Internal input/use-case failure; independent of persistence and module outputs. */
export class AgentFailure extends Error {
	constructor(
		readonly code: AgentOperationErrorCode,
		options?: ErrorOptions,
	) {
		super('Agent: ' + code, options);
		this.name = 'AgentFailure';
	}
}

/** A persisted unknown resource refuses new work; this refusal dispatched no new effect. */
export class AgentResourceFenced extends AgentFailure {
	constructor(options?: ErrorOptions) {
		super('operation_unknown', options);
		this.name = 'AgentResourceFenced';
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

/** Expected remote operation refusal, independent of Provider errors and durable commit uncertainty. */
export class ToolOperationRefusal extends Error {
	constructor(
		readonly code:
			| Extract<
					import('@nexus-terminal/shared/remote/files/values').RemoteFileErrorCode,
					'remote_unavailable' | 'host_key_untrusted' | 'not_text'
			  >
			| 'command_failed',
		options?: ErrorOptions,
	) {
		super('Agent tool refused: ' + code, options);
		this.name = 'ToolOperationRefusal';
	}
}

/** The remote operation is uncertain; unlike an unknown DB commit, its journal may be settled. */
export class ToolExecutionUnknown extends AgentFailure {
	constructor(options?: ErrorOptions) {
		super('operation_unknown', options);
		this.name = 'ToolExecutionUnknown';
	}
}

/** Resource cleanup remains unconfirmed; occupied capacity must be retained. */
export class ToolCleanupFailure extends ToolExecutionUnknown {
	constructor(options?: ErrorOptions) {
		super(options);
		this.name = 'ToolCleanupFailure';
	}
}

/** Business refusals are expected; persistence and unknown failures remain shutdown evidence. */
export function isAgentDrainFailure(error: unknown): boolean {
	if (error instanceof ToolOperationRefusal || error instanceof AgentResourceFenced) {
		return false;
	}
	return (
		!(error instanceof AgentFailure) ||
		error.code === 'storage_unavailable' ||
		error.code === 'operation_unknown' ||
		error.code === 'internal_failure'
	);
}
