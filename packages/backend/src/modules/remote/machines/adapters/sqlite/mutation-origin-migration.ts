import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

/** Preserve recovery evidence from removed producers without retaining their runtime source. */
export async function retireMutationOrigin(tx: SqlExecutor): Promise<void> {
	await tx.exec(`PRAGMA defer_foreign_keys=ON;
	CREATE TABLE remote_machine_mutation_claims_replacement (
		id TEXT PRIMARY KEY,
		owner_id TEXT NOT NULL,
		origin TEXT NOT NULL CHECK(origin IN ('files','docker','retired','tools')),
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
	INSERT INTO remote_machine_mutation_claims_replacement
	SELECT id,owner_id,CASE origin WHEN 'agent' THEN 'retired' ELSE origin END,
	 targets_json,resource_count,state,revision,created_at,blocked_at,released_at
	FROM remote_machine_mutation_claims;
	DROP TABLE remote_machine_mutation_claims;
	ALTER TABLE remote_machine_mutation_claims_replacement RENAME TO remote_machine_mutation_claims;`);
}
