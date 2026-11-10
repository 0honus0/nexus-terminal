// Frozen published database migration dependency. Not an application API.
import type { SqlExecutor } from '../../../../../../../sql-types.js';

export async function initializeOperationContents(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_operation_contents (
	 id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,app_id TEXT NOT NULL,run_id TEXT NOT NULL,
	 owner_id TEXT NOT NULL,content_key TEXT NOT NULL,media_type TEXT NOT NULL,
	 chunks INTEGER NOT NULL DEFAULT 0 CHECK(chunks>=0),sealed INTEGER NOT NULL DEFAULT 0 CHECK(sealed IN (0,1)),
	 sha256 TEXT CHECK(sha256 IS NULL OR length(sha256)=64),size_bytes INTEGER NOT NULL DEFAULT 0 CHECK(size_bytes>=0),
	 UNIQUE(run_id,owner_id,content_key),CHECK((sealed=1)=(sha256 IS NOT NULL)),
	 FOREIGN KEY(run_id,user_id,app_id) REFERENCES agent_runs(id,user_id,app_id) ON DELETE CASCADE
	) STRICT;
	CREATE TABLE agent_operation_content_chunks (
	 content_id TEXT NOT NULL REFERENCES agent_operation_contents(id) ON DELETE CASCADE,
	 chunk_index INTEGER NOT NULL CHECK(chunk_index>=0),text TEXT NOT NULL,
	 sha256 TEXT NOT NULL CHECK(length(sha256)=64),size_bytes INTEGER NOT NULL CHECK(size_bytes>=0),
	 PRIMARY KEY(content_id,chunk_index)
	) STRICT;`);
}
