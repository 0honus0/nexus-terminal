// Frozen published database migration dependency. Not an application API.
import type { SqlExecutor } from '../../../../../../../../sql-types.js';

export async function initializeModelRegistry(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
		CREATE TABLE agent_model_capability_registry (
			id INTEGER PRIMARY KEY CHECK (id=1),
			snapshot_json TEXT,
			last_attempt_at INTEGER,
			last_success_at INTEGER,
			last_error_code TEXT
		);
		INSERT INTO agent_model_capability_registry(id) VALUES(1);
	`);
}
