import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';

export async function initializeAgentRunSchema(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
		CREATE TABLE agent_runs(
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			app_id TEXT NOT NULL,
			thread_id TEXT NOT NULL,
			run_kind TEXT NOT NULL CHECK(run_kind='root'),
			status TEXT NOT NULL CHECK(status IN ('pending','cancelled')),
			version INTEGER NOT NULL CHECK(version>=1),
			input_text TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			FOREIGN KEY(thread_id,user_id,app_id) REFERENCES agent_threads(id,user_id,app_id)
		);
		CREATE UNIQUE INDEX agent_one_active_root_per_thread
			ON agent_runs(thread_id) WHERE run_kind='root' AND status='pending';
		CREATE INDEX agent_runs_scope_idx ON agent_runs(user_id,app_id,thread_id,id);
		CREATE TABLE agent_run_events(
			run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
			sequence INTEGER NOT NULL CHECK(sequence>=1),
			event_type TEXT NOT NULL CHECK(event_type IN ('run.created','run.cancelled')),
			run_version INTEGER NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY(run_id,sequence)
		);
		CREATE TABLE agent_command_idempotency(
			user_id INTEGER NOT NULL,
			app_id TEXT NOT NULL,
			command_name TEXT NOT NULL CHECK(command_name IN ('create_run','cancel_run')),
			operation_key TEXT NOT NULL,
			request_hash TEXT NOT NULL,
			run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
			result_status TEXT NOT NULL CHECK(result_status IN ('pending','cancelled')),
			result_outcome TEXT NOT NULL CHECK(result_outcome IN ('created','cancelled','already_cancelled')),
			result_version INTEGER NOT NULL,
			result_created_at INTEGER NOT NULL,
			result_updated_at INTEGER NOT NULL,
			PRIMARY KEY(user_id,app_id,command_name,operation_key)
		);
		CREATE INDEX agent_idempotency_run_idx ON agent_command_idempotency(run_id);
	`);
}
