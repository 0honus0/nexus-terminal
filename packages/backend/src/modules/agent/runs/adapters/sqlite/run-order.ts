import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import { storedInteger } from './run-participant-sql.js';

/** Called only inside the same transaction that creates the Run. */
export async function nextThreadSequence(tx: SqlExecutor, threadId: string): Promise<number> {
	const row = await tx.one(
		'SELECT COALESCE(MAX(thread_sequence),0)+1 AS sequence FROM agent_runs WHERE thread_id=?',
		[threadId],
	);
	if (row === null) {
		throw new Error('Missing Thread sequence allocation');
	}
	return storedInteger(row.sequence, 1);
}
