import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import { CONTEXT_SNAPSHOT_MAX_BYTES } from '../../context-limits.js';

export async function initializeAutomaticCompactions(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_context_compactions(
		id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
		root_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
		step_index INTEGER NOT NULL CHECK(step_index>=1),
		state TEXT NOT NULL CHECK(state IN ('reserved','dispatched','completed','failed','unknown')),
		request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
		creation_hash TEXT NOT NULL CHECK(length(creation_hash)=64),
		source_json TEXT NOT NULL CHECK(length(CAST(source_json AS BLOB)) BETWEEN 1 AND ${CONTEXT_SNAPSHOT_MAX_BYTES}),
		source_hash TEXT NOT NULL CHECK(length(source_hash)=64),
		cut_index INTEGER NOT NULL CHECK(cut_index>0),
		estimated_tokens INTEGER NOT NULL CHECK(estimated_tokens>0),
		input_tokens INTEGER, output_tokens INTEGER, summary_text TEXT,
		created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
		CHECK((input_tokens IS NULL AND output_tokens IS NULL) OR (input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND input_tokens>=0 AND output_tokens>=0)),
		CHECK((state='completed' AND summary_text IS NOT NULL) OR (state!='completed' AND summary_text IS NULL))
	);
	CREATE UNIQUE INDEX agent_compaction_active ON agent_context_compactions(run_id) WHERE state IN ('reserved','dispatched');
	CREATE INDEX agent_compaction_family ON agent_context_compactions(root_id);
	`);
}
