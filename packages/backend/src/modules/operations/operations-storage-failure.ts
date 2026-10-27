import { SqliteFailure } from '../../platform/storage/sqlite/sqlite-errors.js';
import { OperationsFailure } from './operations-failure.js';
import { OperationsStorageRefusal } from './operations-storage-refusal.js';

export async function operationsStorage<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof OperationsStorageRefusal) {
			throw new OperationsFailure(error.code, { cause: error });
		}
		if (error instanceof OperationsFailure) {
			throw error;
		}
		if (error instanceof SqliteFailure) {
			throw new OperationsFailure(
				error.kind === 'commit_unknown' || error.kind === 'rollback_failed'
					? 'operation_unknown'
					: 'storage_unavailable',
				{ cause: error },
			);
		}
		throw new OperationsFailure('internal_failure', { cause: error });
	}
}
