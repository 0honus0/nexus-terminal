import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import { CONTEXT_SNAPSHOT_MAX_BYTES } from '../../context-limits.js';

export async function initializeContextSnapshots(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
		CREATE TABLE agent_model_contexts(
			run_id TEXT NOT NULL,
			step_index INTEGER NOT NULL,
			content_json TEXT NOT NULL CHECK(length(CAST(content_json AS BLOB)) BETWEEN 1 AND ${CONTEXT_SNAPSHOT_MAX_BYTES}),
			content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
			PRIMARY KEY(run_id,step_index),
			FOREIGN KEY(run_id,step_index) REFERENCES agent_run_model_steps(run_id,step_index) ON DELETE CASCADE
		);
	`);
}
