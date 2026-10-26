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

/** A SQL statement definitely failed; unknown commit/rollback outcomes use their own failure. */
export class AgentStorageStatementFailure extends AgentFailure {
	constructor(options?: ErrorOptions) {
		super('internal_failure', options);
		this.name = 'AgentStorageStatementFailure';
	}
}

/** Aggregated local statement failures still prove that no commit-unknown evidence was reported. */
export function isAgentStorageStatementFailure(error: unknown): boolean {
	return (
		error instanceof AgentStorageStatementFailure ||
		(error instanceof AggregateError &&
			error.errors.length > 0 &&
			error.errors.every(isAgentStorageStatementFailure))
	);
}

/** Definite pre-dispatch capacity refusal; the original Run may wait without replaying effects. */
export class ModelCapacityBusy extends AgentFailure {
	constructor() {
		super('limit_exceeded');
		this.name = 'ModelCapacityBusy';
	}
}

/** Context capacity refusal, distinct from execution time/request/budget limits. */
export class ContextLimitExceeded extends AgentFailure {
	constructor() {
		super('limit_exceeded');
		this.name = 'ContextLimitExceeded';
	}
}

/** Current App capability/target grant is absent; distinct from stale authority or resource refusals. */
export class ToolCapabilityDenied extends AgentFailure {
	constructor() {
		super('forbidden');
		this.name = 'ToolCapabilityDenied';
	}
}

/** A persisted unknown resource refuses new work; this refusal dispatched no new effect. */
export class AgentResourceFenced extends AgentFailure {
	constructor(options?: ErrorOptions) {
		super('operation_unknown', options);
		this.name = 'AgentResourceFenced';
	}
}

/** Aggregation must not turn an existing resource fence into a new shutdown fault. */
export function aggregateAgentFailures(failures: unknown[], message: string): AgentFailure {
	const cause = new AggregateError(failures, message);
	if (failures.length > 0 && failures.every(resourceFenced)) {
		return new AgentResourceFenced({ cause });
	}
	return new AgentFailure('operation_unknown', { cause });
}

function resourceFenced(error: unknown): boolean {
	return (
		error instanceof AgentResourceFenced ||
		(error instanceof AggregateError && error.errors.length > 0 && error.errors.every(resourceFenced))
	);
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

function unconfirmedEffects(error: unknown): boolean {
	return (
		error instanceof ToolExecutionUnknown ||
		(error instanceof AggregateError && error.errors.length > 0 && error.errors.every(unconfirmedEffects))
	);
}

function cleanupFailed(error: unknown): boolean {
	return error instanceof ToolCleanupFailure || (error instanceof AggregateError && error.errors.some(cleanupFailed));
}

/** Preserve effect uncertainty across owners without guessing after an uncertain storage commit. */
export function aggregateToolFailures(failures: unknown[], message: string): Error {
	const cause = new AggregateError(failures, message);
	if (failures.length && failures.every(unconfirmedEffects)) {
		return failures.some(cleanupFailed) ? new ToolCleanupFailure({ cause }) : new ToolExecutionUnknown({ cause });
	}
	return cause;
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
