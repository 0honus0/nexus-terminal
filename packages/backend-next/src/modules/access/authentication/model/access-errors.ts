import { SqliteFailure } from '../../../../platform/storage/sqlite/sqlite-errors.js';
import { AccessFailure } from '../service/access-service.js';

export type AccessErrorCode =
	| 'invalid_input'
	| 'already_initialized'
	| 'invalid_credentials'
	| 'conflict'
	| 'storage_unavailable'
	| 'internal_failure';

export class AccessOperationError extends Error {
	constructor(
		readonly code: AccessErrorCode,
		options?: ErrorOptions,
	) {
		super('Access operation failed: ' + code, options);
		this.name = 'AccessOperationError';
	}
}

export async function accessBoundary<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof AccessOperationError) {
			throw error;
		}
		if (error instanceof AccessFailure) {
			throw new AccessOperationError(error.code);
		}
		if (error instanceof SqliteFailure) {
			const code = ['unavailable', 'worker_exit', 'closed', 'busy', 'rollback_failed', 'commit_unknown'].includes(
				error.kind,
			)
				? 'storage_unavailable'
				: error.kind === 'constraint'
					? 'conflict'
					: 'internal_failure';
			throw new AccessOperationError(code);
		}
		throw new AccessOperationError('internal_failure');
	}
}
