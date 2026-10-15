import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeMachineMutations(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE remote_machine_mutations (
		resource_key TEXT PRIMARY KEY,
		claim_id TEXT NOT NULL,
		state TEXT NOT NULL CHECK(state IN ('held','blocked')),
		created_at INTEGER NOT NULL
	);
	CREATE INDEX remote_machine_mutations_claim ON remote_machine_mutations(claim_id);`);
}
