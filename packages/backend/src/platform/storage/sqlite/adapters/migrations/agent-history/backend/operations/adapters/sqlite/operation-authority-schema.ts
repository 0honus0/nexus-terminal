// Frozen published database migration dependency. Not an application API.
import type { SqlExecutor } from '../../../../../../../sql-types.js';

/** Real domain effects recheck the same committed dispatch proof, without another execution ledger. */
export async function initializeOperationAuthorities(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_operation_authorities (
	 operation_id TEXT PRIMARY KEY REFERENCES agent_operations(id) ON DELETE CASCADE,
	 proof_json TEXT NOT NULL CHECK(json_valid(proof_json))
	) STRICT;`);
}
