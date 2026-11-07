import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

/** One execution generation admits generic operations without requiring a model step. */
export async function initializeOperations(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
		CREATE TABLE agent_run_executions (
			run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
			generation TEXT NOT NULL UNIQUE,
			state TEXT NOT NULL CHECK(state IN ('open','draining','closed')),
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY(run_id,generation)
		) STRICT;
		CREATE UNIQUE INDEX agent_run_executions_active ON agent_run_executions(run_id) WHERE state<>'closed';
		CREATE TABLE agent_operations (
			id TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			app_id TEXT NOT NULL,
			run_id TEXT NOT NULL,
			execution_generation TEXT NOT NULL REFERENCES agent_run_executions(generation),
			parent_id TEXT REFERENCES agent_operations(id),
			caller_id TEXT NOT NULL,
			operation_key TEXT NOT NULL,
			request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
			kind TEXT NOT NULL CHECK(kind IN ('model','tool','effect')),
			label TEXT NOT NULL,
			binding_json TEXT NOT NULL CHECK(json_valid(binding_json)),
			arguments_json TEXT NOT NULL CHECK(json_valid(arguments_json)),
			state TEXT NOT NULL CHECK(state IN ('accepted','dispatched','completed','failed','cancelled','unknown')),
			revision INTEGER NOT NULL CHECK(revision>=1),
			result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
			failure_code TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			UNIQUE(run_id,caller_id,operation_key),
			FOREIGN KEY(run_id,user_id,app_id) REFERENCES agent_runs(id,user_id,app_id) ON DELETE CASCADE,
			CHECK((state='completed')=(result_json IS NOT NULL)),
			CHECK((state='failed')=(failure_code IS NOT NULL))
		) STRICT;
		CREATE INDEX agent_operations_run_state ON agent_operations(run_id,state);
		CREATE INDEX agent_operations_parent ON agent_operations(parent_id);
		CREATE TABLE agent_operation_model_reservations (
			operation_id TEXT PRIMARY KEY REFERENCES agent_operations(id) ON DELETE CASCADE,
			root_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
			provider_id TEXT NOT NULL REFERENCES agent_providers(id),
			reserved_tokens INTEGER NOT NULL CHECK(reserved_tokens>=1),
			input_tokens INTEGER CHECK(input_tokens>=0),
			output_tokens INTEGER CHECK(output_tokens>=0),
			CHECK((input_tokens IS NULL)=(output_tokens IS NULL))
		) STRICT;
		CREATE INDEX agent_operation_model_reservations_root ON agent_operation_model_reservations(root_id);
		CREATE TABLE agent_operation_approvals (
			id TEXT PRIMARY KEY,
			operation_id TEXT NOT NULL UNIQUE REFERENCES agent_operations(id) ON DELETE CASCADE,
			operation_hash TEXT NOT NULL CHECK(length(operation_hash)=64),
			policy_revision INTEGER NOT NULL,
			status TEXT NOT NULL CHECK(status IN ('requested','approved','denied','expired','superseded')),
			version INTEGER NOT NULL CHECK(version>=1),
			expires_at INTEGER NOT NULL,
			consumed_at INTEGER
		) STRICT;
	`);
}
