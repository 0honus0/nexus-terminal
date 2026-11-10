// Frozen published database migration dependency. Not an application API.
import type { SqlExecutor } from '../../../../../../../sql-types.js';

export async function sequenceOperations(tx: SqlExecutor): Promise<void> {
	await tx.exec(`ALTER TABLE agent_operations ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0;
	 UPDATE agent_operations SET sequence=rowid;
	 CREATE UNIQUE INDEX agent_operations_sequence ON agent_operations(sequence);`);
}
