import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeAgentRunSchema(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
		CREATE TABLE agent_runs(
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			app_id TEXT NOT NULL,
			thread_id TEXT NOT NULL,
			thread_sequence INTEGER NOT NULL CHECK(thread_sequence>=1),
			run_kind TEXT NOT NULL CHECK(run_kind IN ('root','child')),
			approval_mode TEXT NOT NULL CHECK(approval_mode IN ('ask','full_access')),
			status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed','unknown','cancelled')),
			version INTEGER NOT NULL CHECK(version>=1),
			input_text TEXT NOT NULL,
			deadline_at INTEGER NOT NULL,
			selected_connections_json TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			UNIQUE(id,user_id,app_id),
			UNIQUE(thread_id,thread_sequence),
			FOREIGN KEY(thread_id,user_id,app_id) REFERENCES agent_threads(id,user_id,app_id)
		);
		CREATE UNIQUE INDEX agent_one_active_root_per_thread
			ON agent_runs(thread_id) WHERE run_kind='root' AND status IN ('pending','running','unknown');
		CREATE INDEX agent_runs_scope_idx ON agent_runs(user_id,app_id,thread_id,id);
		CREATE TABLE agent_run_events(
			run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
			sequence INTEGER NOT NULL CHECK(sequence>=1),
			event_type TEXT NOT NULL CHECK(event_type IN ('run.created','run.started','run.completed','run.failed','run.unknown','run.cancelled')),
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

/** Model steps share the single Run authority. */
export async function initializeAgentRunSteps(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
		CREATE TABLE agent_run_model_steps(
			run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
			step_index INTEGER NOT NULL CHECK(step_index>=1),
			state TEXT NOT NULL CHECK(state IN ('reserved','dispatched','completed','failed','unknown')),
			revision INTEGER NOT NULL CHECK(revision>=1),
			expected_run_version INTEGER NOT NULL CHECK(expected_run_version>=1),
			request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
			creation_hash TEXT NOT NULL CHECK(length(creation_hash)=64),
			response_received INTEGER NOT NULL DEFAULT 0 CHECK(response_received IN (0,1)),
			text_bytes INTEGER NOT NULL DEFAULT 0 CHECK(text_bytes BETWEEN 0 AND 2097152),
			input_tokens INTEGER CHECK(input_tokens IS NULL OR input_tokens>=0),
			output_tokens INTEGER CHECK(output_tokens IS NULL OR output_tokens>=0),
			finish_reason TEXT CHECK(finish_reason IS NULL OR finish_reason IN ('stop','tool_calls')),
			proposals_json TEXT NOT NULL DEFAULT '[]',
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
		CREATE UNIQUE INDEX agent_one_unsettled_model_step ON agent_run_model_steps(run_id)
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
