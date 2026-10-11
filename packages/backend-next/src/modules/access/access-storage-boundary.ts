import { SqliteFailure } from '../../platform/storage/sqlite/sqlite-errors.js';
import { AccessFailure } from './authentication/model/access-failure.js';

/** Called by Access Models; the public boundary only sees application failures. */
export async function accessStorageBoundary<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof AccessFailure) {
			throw error;
		}
		if (!(error instanceof SqliteFailure)) {
			throw new AccessFailure('internal_failure', { cause: error });
		}
		switch (error.kind) {
			case 'commit_unknown':
			case 'rollback_failed':
				throw new AccessFailure('operation_unknown', { cause: error });
			case 'unavailable':
			case 'worker_exit':
			case 'closed':
			case 'busy':
				throw new AccessFailure('storage_unavailable', { cause: error });
			case 'constraint':
				throw new AccessFailure('conflict', { cause: error });
			default:
				throw new AccessFailure('internal_failure', { cause: error });
		}
	}
}
