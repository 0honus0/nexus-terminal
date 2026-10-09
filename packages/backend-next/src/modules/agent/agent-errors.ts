import { SqliteFailure } from '../../platform/storage/sqlite/sqlite-errors.js';

export type AgentErrorCode =
	| 'invalid_input'
	| 'not_found'
	| 'active_run_conflict'
	| 'idempotency_conflict'
	| 'version_conflict'
	| 'storage_unavailable'
	| 'internal_failure';

export class AgentOperationError extends Error {
	constructor(readonly code: AgentErrorCode) {
		super('Agent operation failed: ' + code);
		this.name = 'AgentOperationError';
	}
}

export function validateUserId(id: number): void {
	if (!Number.isSafeInteger(id) || id < 1) throw new AgentOperationError('invalid_input');
}

export function validateAgentId(id: string): void {
	if (
		typeof id !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)
	) {
		throw new AgentOperationError('invalid_input');
	}
}

export function validateOperationKey(key: string): void {
	validateAgentId(key);
}

export async function agentBoundary<T>(action: () => Promise<T>): Promise<T> {
	try {
		return await action();
	} catch (error) {
		if (error instanceof AgentOperationError) throw error;
		if (error instanceof SqliteFailure) {
			if (
				['closed', 'unavailable', 'worker_exit', 'busy', 'rollback_failed', 'commit_unknown'].includes(
					error.kind,
				)
			) {
				throw new AgentOperationError('storage_unavailable');
			}
		}
		// The underlying SQL, internal payload or arbitrary source errors are private.
		throw new AgentOperationError('internal_failure');
	}
}
