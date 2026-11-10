// Frozen published database migration dependency. Not an application API.
import type { SqlExecutor } from '../../../../../../../sql-types.js';

/** Replace only constrained columns; retaining the parent table preserves all foreign-key identities. */
export async function allowRunSuspension(tx: SqlExecutor): Promise<void> {
	await tx.exec(`DROP INDEX agent_one_active_root_per_thread;
	 ALTER TABLE agent_runs RENAME COLUMN status TO previous_status;
	 ALTER TABLE agent_runs ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
	 CHECK(status IN ('pending','running','suspended','completed','failed','unknown','cancelled'));
	 UPDATE agent_runs SET status=previous_status;
	 ALTER TABLE agent_runs DROP COLUMN previous_status;
	 CREATE UNIQUE INDEX agent_one_active_root_per_thread ON agent_runs(thread_id)
	 WHERE run_kind='root' AND status IN ('pending','running','suspended','unknown');
	 ALTER TABLE agent_run_events RENAME COLUMN event_type TO previous_event_type;
	 ALTER TABLE agent_run_events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'run.created'
	 CHECK(event_type IN ('run.created','run.started','run.resumed','run.suspended','run.completed','run.failed','run.unknown','run.cancelled'));
	 UPDATE agent_run_events SET event_type=previous_event_type;
	 ALTER TABLE agent_run_events DROP COLUMN previous_event_type;`);
}

export async function initializeRunSuspensions(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_run_suspensions (
	 run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
	 run_version INTEGER NOT NULL CHECK(run_version>=1),
	 execution_generation TEXT NOT NULL,
	 checkpoint_version INTEGER NOT NULL CHECK(checkpoint_version>=1),
	 input_request_json TEXT NOT NULL CHECK(json_valid(input_request_json)),
	 suspended_at INTEGER NOT NULL,
	 resumed_at INTEGER CHECK(resumed_at IS NULL OR resumed_at>=suspended_at),
	 resume_input_json TEXT CHECK(resume_input_json IS NULL OR json_valid(resume_input_json)),
	 PRIMARY KEY(run_id,run_version),
	 CHECK((resumed_at IS NULL)=(resume_input_json IS NULL))
	) STRICT;
	 CREATE UNIQUE INDEX agent_one_waiting_suspension ON agent_run_suspensions(run_id) WHERE resumed_at IS NULL;`);
}

export async function initializeRunResumeCommands(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_run_resume_commands (
	 user_id INTEGER NOT NULL,app_id TEXT NOT NULL,operation_key TEXT NOT NULL,
	 run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
	 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
	 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
	 PRIMARY KEY(user_id,app_id,operation_key)
	) STRICT;`);
}
