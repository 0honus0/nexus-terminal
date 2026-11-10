// Frozen published database migration dependency. Not an application API.
import type { SqlExecutor } from '../../../../../../../sql-types.js';

export async function initializeRunAppState(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_app_checkpoints (
	 run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
	 execution_generation TEXT NOT NULL REFERENCES agent_run_executions(generation),
	 version INTEGER NOT NULL CHECK(version>=1),
	 document_json TEXT NOT NULL CHECK(json_valid(document_json)),
	 updated_at INTEGER NOT NULL
	) STRICT;
	CREATE TABLE agent_app_messages (
	 id TEXT PRIMARY KEY,
	 run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
	 owner_id TEXT NOT NULL,
	 message_key TEXT NOT NULL,
	 ordinal INTEGER NOT NULL CHECK(ordinal>=1),
	 operation_id TEXT REFERENCES agent_operations(id),
	 chunks INTEGER NOT NULL CHECK(chunks>=0),
	 created_at INTEGER NOT NULL,
	 UNIQUE(run_id,owner_id,message_key),
	 UNIQUE(run_id,ordinal)
	) STRICT;
	CREATE TABLE agent_app_message_chunks (
	 message_id TEXT NOT NULL REFERENCES agent_app_messages(id) ON DELETE CASCADE,
	 chunk_index INTEGER NOT NULL CHECK(chunk_index>=0),
	 text TEXT NOT NULL,
	 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
	 created_at INTEGER NOT NULL,
	 PRIMARY KEY(message_id,chunk_index)
	) STRICT;`);
}
