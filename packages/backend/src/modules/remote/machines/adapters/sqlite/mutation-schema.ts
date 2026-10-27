import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeMachineMutations(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE remote_machine_mutation_claims (
		id TEXT PRIMARY KEY,
		owner_id TEXT NOT NULL,
		origin TEXT NOT NULL CHECK(origin IN ('files','docker','agent','tools')),
		targets_json TEXT NOT NULL,
		resource_count INTEGER NOT NULL CHECK(resource_count IN (1,2)),
		state TEXT NOT NULL CHECK(state IN ('held','blocked','released')),
		revision INTEGER NOT NULL CHECK(revision >= 1),
		created_at INTEGER NOT NULL,
		blocked_at INTEGER,
		released_at INTEGER,
		CHECK((state='held' AND blocked_at IS NULL AND released_at IS NULL)
			OR (state='blocked' AND blocked_at IS NOT NULL AND released_at IS NULL)
			OR (state='released' AND blocked_at IS NOT NULL AND released_at IS NOT NULL))
	);
	CREATE TABLE remote_machine_mutations (
		resource_key TEXT PRIMARY KEY,
		claim_id TEXT NOT NULL REFERENCES remote_machine_mutation_claims(id),
		state TEXT NOT NULL CHECK(state IN ('held','blocked')),
		created_at INTEGER NOT NULL
	);
	CREATE INDEX remote_machine_mutations_claim ON remote_machine_mutations(claim_id);
	CREATE TABLE remote_machine_mutation_evidence (
		id TEXT PRIMARY KEY,
		claim_id TEXT NOT NULL REFERENCES remote_machine_mutation_claims(id),
		claim_revision INTEGER NOT NULL CHECK(claim_revision >= 1),
		outcome TEXT NOT NULL CHECK(outcome IN ('applied','not_applied','partially_applied')),
		observed_at INTEGER NOT NULL,
		note TEXT NOT NULL,
		recorded_by INTEGER NOT NULL,
		created_at INTEGER NOT NULL,
		UNIQUE(claim_id,claim_revision)
	);`);
}
