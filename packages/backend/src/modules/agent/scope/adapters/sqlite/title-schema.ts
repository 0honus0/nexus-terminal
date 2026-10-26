import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeThreadTitles(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_thread_titles(
		run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
		thread_id TEXT NOT NULL UNIQUE REFERENCES agent_threads(id) ON DELETE CASCADE,
		thread_version INTEGER NOT NULL CHECK(thread_version>=1),
		state TEXT NOT NULL CHECK(state IN ('reserved','dispatched','completed','failed','unknown')),
		creation_hash TEXT NOT NULL CHECK(length(creation_hash)=64),
		request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
		estimated_tokens INTEGER NOT NULL CHECK(estimated_tokens>0),
		input_tokens INTEGER, output_tokens INTEGER,
		created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
		CHECK((input_tokens IS NULL AND output_tokens IS NULL) OR (input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND input_tokens>=0 AND output_tokens>=0))
	);`);
}
