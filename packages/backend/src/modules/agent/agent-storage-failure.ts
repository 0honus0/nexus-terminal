import { SqliteFailure } from '../../platform/storage/sqlite/sqlite-errors.js';
import { AgentFailure, AgentStorageStatementFailure } from './agent-failure.js';

/** Application/storage boundary; causes stay private. */
export async function agentStorage<T>(action: () => Promise<T>): Promise<T> {
	try {
		return await action();
	} catch (error) {
		if (error instanceof AgentFailure) {
			throw error;
		}
		if (error instanceof SqliteFailure) {
			if (error.kind === 'sql' || error.kind === 'constraint') {
				throw new AgentStorageStatementFailure({ cause: error });
			}
			if (error.kind === 'commit_unknown' || error.kind === 'rollback_failed') {
				throw new AgentFailure('operation_unknown', { cause: error });
			}
			if (
				error.kind === 'closed' ||
				error.kind === 'unavailable' ||
				error.kind === 'worker_exit' ||
				error.kind === 'busy'
			) {
				throw new AgentFailure('storage_unavailable', { cause: error });
			}
		}
		throw new AgentFailure('internal_failure', { cause: error });
	}
}
