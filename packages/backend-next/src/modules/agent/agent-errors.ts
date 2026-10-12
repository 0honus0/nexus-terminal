import { AgentFailure } from './agent-failure.js';
import { SqliteFailure } from '../../platform/storage/sqlite/sqlite-errors.js';
import { AgentOperationError } from './public-errors.js';

export async function agentBoundary<T>(action: () => Promise<T>): Promise<T> {
	try {
		return await action();
	} catch (error) {
		if (error instanceof AgentOperationError) {
			throw error;
		}
		if (error instanceof AgentFailure) {
			throw new AgentOperationError(error.code);
		}
		if (error instanceof SqliteFailure) {
			if (error.kind === 'commit_unknown' || error.kind === 'rollback_failed') {
				throw new AgentOperationError('operation_unknown');
			}
			if (['closed', 'unavailable', 'worker_exit', 'busy'].includes(error.kind)) {
				throw new AgentOperationError('storage_unavailable');
			}
		}
		// The underlying SQL, internal payload or arbitrary source errors are private.
		throw new AgentOperationError('internal_failure');
	}
}
