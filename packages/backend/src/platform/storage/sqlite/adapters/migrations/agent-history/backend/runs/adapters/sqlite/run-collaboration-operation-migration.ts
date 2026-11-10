// Frozen published database migration dependency. Not an application API.
import type { SqlExecutor } from '../../../../../../../sql-types.js';

/** Historical model-step relations remain audit data; new children and messages reference real Operations. */
export async function bindCollaborationToOperations(tx: SqlExecutor): Promise<void> {
	await tx.exec(`DROP INDEX agent_run_children_parent;
	 DROP INDEX agent_run_mailbox_root;
	 ALTER TABLE agent_run_children RENAME TO agent_legacy_run_children;
	 ALTER TABLE agent_run_mailbox RENAME TO agent_legacy_run_mailbox;
	 ALTER TABLE agent_collaboration_effects RENAME TO agent_legacy_collaboration_effects;
	 CREATE TABLE agent_run_children(
	 run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
	 parent_id TEXT NOT NULL REFERENCES agent_runs(id),
	 operation_id TEXT NOT NULL UNIQUE REFERENCES agent_operations(id),
	 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),profile TEXT NOT NULL,
	 output_text TEXT,tools_json TEXT NOT NULL CHECK(json_valid(tools_json)),
	 max_requests INTEGER NOT NULL CHECK(max_requests BETWEEN 1 AND 9007199254740991),
	 dependencies_json TEXT NOT NULL CHECK(json_valid(dependencies_json)),
	 dependency_mode TEXT NOT NULL CHECK(dependency_mode IN ('success','settled')),CHECK(run_id!=parent_id));
	 CREATE INDEX agent_run_children_parent ON agent_run_children(parent_id,run_id);
	 CREATE TABLE agent_run_mailbox(
	 root_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
	 recipient_id TEXT NOT NULL REFERENCES agent_runs(id),sequence INTEGER NOT NULL CHECK(sequence>=1),
	 message_id TEXT NOT NULL UNIQUE REFERENCES agent_operations(id),sender_id TEXT NOT NULL REFERENCES agent_runs(id),
	 body_text TEXT NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(recipient_id,sequence));
	 CREATE INDEX agent_run_mailbox_root ON agent_run_mailbox(root_id);
	 CREATE TABLE agent_collaboration_effects(
	 operation_id TEXT PRIMARY KEY REFERENCES agent_operations(id) ON DELETE CASCADE,result_json TEXT NOT NULL CHECK(json_valid(result_json)));`);
}
