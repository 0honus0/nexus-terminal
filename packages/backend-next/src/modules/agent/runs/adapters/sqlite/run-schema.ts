import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

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

/** v8 adds a child journal to the existing Run owner, without rewriting v3/v7 or inventing a second Run registry. */
export async function migrateAgentRunSteps(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
		CREATE TABLE agent_run_model_steps(
			run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
			step_index INTEGER NOT NULL CHECK(step_index>=1),
			state TEXT NOT NULL CHECK(state IN ('reserved','dispatched','completed','failed','unknown')),
			revision INTEGER NOT NULL CHECK(revision>=1),
			expected_run_version INTEGER NOT NULL CHECK(expected_run_version>=1),
			request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
			text_bytes INTEGER NOT NULL DEFAULT 0 CHECK(text_bytes BETWEEN 0 AND 2097152),
			input_tokens INTEGER CHECK(input_tokens IS NULL OR input_tokens>=0),
			output_tokens INTEGER CHECK(output_tokens IS NULL OR output_tokens>=0),
			finish_reason TEXT CHECK(finish_reason IS NULL OR finish_reason='stop'),
			failure_code TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY(run_id,step_index),
			CHECK((input_tokens IS NULL)=(output_tokens IS NULL)),
			CHECK((state='completed')=(finish_reason IS NOT NULL)),
			CHECK((state='failed')=(failure_code IS NOT NULL))
		);
		CREATE INDEX agent_run_model_steps_unsettled ON agent_run_model_steps(state,run_id)
			WHERE state IN ('reserved','dispatched');
		CREATE TABLE agent_run_model_step_events(
			run_id TEXT NOT NULL,
			step_index INTEGER NOT NULL,
			sequence INTEGER NOT NULL CHECK(sequence>=1),
			kind TEXT NOT NULL CHECK(kind IN ('text.delta','usage','step.completed','step.failed','step.unknown')),
			text_delta TEXT,
			input_tokens INTEGER CHECK(input_tokens IS NULL OR input_tokens>=0),
			output_tokens INTEGER CHECK(output_tokens IS NULL OR output_tokens>=0),
			created_at INTEGER NOT NULL,
			PRIMARY KEY(run_id,step_index,sequence),
			FOREIGN KEY(run_id,step_index) REFERENCES agent_run_model_steps(run_id,step_index) ON DELETE CASCADE,
			CHECK((input_tokens IS NULL)=(output_tokens IS NULL)),
			CHECK(kind!='text.delta' OR (text_delta IS NOT NULL AND input_tokens IS NULL)),
			CHECK(kind!='usage' OR (text_delta IS NULL AND input_tokens IS NOT NULL)),
			CHECK(kind IN ('text.delta','usage') OR (text_delta IS NULL AND input_tokens IS NULL))
		);
	`);
}

/**
 * v9 rebuilds the single Run authority with expanded terminal states.
 * The bootstrap's exclusive rebuild transaction suspends FKs BEFORE BEGIN,
 * verifies all child references BEFORE COMMIT and restores FKs afterwards.
 * No historical migration signature or child/parent ID is rewritten.
 */
export async function migrateAgentRunLifecycle(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
		CREATE TABLE agent_runs_rebuild_v9(
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			app_id TEXT NOT NULL,
			thread_id TEXT NOT NULL,
			run_kind TEXT NOT NULL CHECK(run_kind='root'),
			status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed','unknown','cancelled')),
			version INTEGER NOT NULL CHECK(version>=1),
			input_text TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			FOREIGN KEY(thread_id,user_id,app_id) REFERENCES agent_threads(id,user_id,app_id)
		);
		INSERT INTO agent_runs_rebuild_v9(
			id,user_id,app_id,thread_id,run_kind,status,version,input_text,created_at,updated_at
		) SELECT id,user_id,app_id,thread_id,run_kind,status,version,input_text,created_at,updated_at
		  FROM agent_runs;
		DROP TABLE agent_runs;
		ALTER TABLE agent_runs_rebuild_v9 RENAME TO agent_runs;
		CREATE UNIQUE INDEX agent_one_active_root_per_thread
			ON agent_runs(thread_id)
			WHERE run_kind='root' AND status IN ('pending','running','unknown');
		CREATE INDEX agent_runs_scope_idx ON agent_runs(user_id,app_id,thread_id,id);
		CREATE TABLE agent_run_events_rebuild_v9(
			run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
			sequence INTEGER NOT NULL CHECK(sequence>=1),
			event_type TEXT NOT NULL CHECK(event_type IN (
				'run.created','run.started','run.completed','run.failed','run.unknown','run.cancelled'
			)),
			run_version INTEGER NOT NULL,
			created_at INTEGER NOT NULL,
			PRIMARY KEY(run_id,sequence)
		);
		INSERT INTO agent_run_events_rebuild_v9(run_id,sequence,event_type,run_version,created_at)
		 SELECT run_id,sequence,event_type,run_version,created_at FROM agent_run_events;
		DROP TABLE agent_run_events;
		ALTER TABLE agent_run_events_rebuild_v9 RENAME TO agent_run_events;
	`);
}
