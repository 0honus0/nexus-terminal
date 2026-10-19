import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeRunCollaboration(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
		CREATE TABLE agent_run_children(
			run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
			parent_id TEXT NOT NULL REFERENCES agent_runs(id),
			operation_id TEXT NOT NULL UNIQUE REFERENCES agent_run_tools(id),
			request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
			profile TEXT NOT NULL,
			output_text TEXT,
			tools_json TEXT NOT NULL,
			max_requests INTEGER NOT NULL CHECK(max_requests BETWEEN 1 AND 32),
			dependencies_json TEXT NOT NULL,
			dependency_mode TEXT NOT NULL CHECK(dependency_mode IN ('success','settled')),
			CHECK(run_id!=parent_id)
		);
		CREATE INDEX agent_run_children_parent ON agent_run_children(parent_id,run_id);
		CREATE TABLE agent_run_facts(
			root_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
			fact_key TEXT NOT NULL,
			value_text TEXT NOT NULL,
			version INTEGER NOT NULL CHECK(version>=1),
			author_id TEXT NOT NULL REFERENCES agent_runs(id),
			PRIMARY KEY(root_id,fact_key)
		);
		CREATE TABLE agent_run_mailbox(
			root_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
			recipient_id TEXT NOT NULL REFERENCES agent_runs(id),
			sequence INTEGER NOT NULL CHECK(sequence>=1),
			message_id TEXT NOT NULL UNIQUE REFERENCES agent_run_tools(id),
			sender_id TEXT NOT NULL REFERENCES agent_runs(id),
			body_text TEXT NOT NULL,
			expires_at INTEGER NOT NULL,
			PRIMARY KEY(recipient_id,sequence)
		);
		CREATE INDEX agent_run_mailbox_root ON agent_run_mailbox(root_id);
		CREATE TABLE agent_run_mailbox_cursors(
			run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
			consumed_through INTEGER NOT NULL CHECK(consumed_through>=0),
			read_through INTEGER NOT NULL CHECK(read_through>=consumed_through)
		);
		CREATE TABLE agent_collaboration_effects(
			operation_id TEXT PRIMARY KEY REFERENCES agent_run_tools(id) ON DELETE CASCADE,
			result_json TEXT NOT NULL
		);
	`);
}
