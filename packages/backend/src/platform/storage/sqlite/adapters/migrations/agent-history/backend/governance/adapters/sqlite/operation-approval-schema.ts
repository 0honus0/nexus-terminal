// Frozen published database migration dependency. Not an application API.
import type { SqlExecutor } from '../../../../../../../sql-types.js';

export async function describeOperationApprovals(tx: SqlExecutor): Promise<void> {
	await tx.exec(`ALTER TABLE agent_operation_approvals ADD COLUMN capability TEXT NOT NULL DEFAULT 'plugin.invoke';
	 ALTER TABLE agent_operation_approvals ADD COLUMN risk TEXT NOT NULL DEFAULT 'mutate';
	 ALTER TABLE agent_operation_approvals ADD COLUMN summary TEXT NOT NULL DEFAULT '';
	 ALTER TABLE agent_operation_approvals ADD COLUMN target_id INTEGER;
	 ALTER TABLE agent_operation_approvals ADD COLUMN requested_at INTEGER NOT NULL DEFAULT 0;
	 ALTER TABLE agent_operation_approvals ADD COLUMN decided_at INTEGER;
	 ALTER TABLE agent_operation_approvals ADD COLUMN decided_by INTEGER;
	 CREATE INDEX agent_operation_approvals_requested ON agent_operation_approvals(status,expires_at);`);
}

export async function sequenceOperationApprovals(tx: SqlExecutor): Promise<void> {
	await tx.exec(`ALTER TABLE agent_operation_approvals ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0;
	 UPDATE agent_operation_approvals SET sequence=rowid;
	 CREATE UNIQUE INDEX agent_operation_approvals_sequence ON agent_operation_approvals(sequence);`);
}

export async function initializeOperationApprovalCommands(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_operation_approval_commands (
	 user_id INTEGER NOT NULL,
	 app_id TEXT NOT NULL,
	 operation_key TEXT NOT NULL,
	 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
	 approval_id TEXT NOT NULL REFERENCES agent_operation_approvals(id) ON DELETE CASCADE,
	 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
	 feedback TEXT,
	 created_at INTEGER NOT NULL,
	 PRIMARY KEY(user_id,app_id,operation_key)
	) STRICT;`);
}
