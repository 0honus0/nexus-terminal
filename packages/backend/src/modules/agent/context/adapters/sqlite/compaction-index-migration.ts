import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function indexCompactionRun(tx: SqlExecutor): Promise<void> {
	await tx.exec('CREATE INDEX agent_compaction_run_lookup ON agent_context_compactions(run_id)');
}
