// Frozen published database migration dependency. Not an application API.
import type { SqlExecutor } from '../../../../../../../sql-types.js';

export async function initializeOperationArtifacts(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_operation_artifacts(
	 operation_id TEXT NOT NULL REFERENCES agent_operations(id) ON DELETE CASCADE,
	 artifact_id TEXT NOT NULL REFERENCES agent_artifacts(id),
	 artifact_version INTEGER NOT NULL CHECK(artifact_version>=1),
	 sha256 TEXT NOT NULL CHECK(length(sha256)=64),size_bytes INTEGER NOT NULL CHECK(size_bytes>=0),
	 PRIMARY KEY(operation_id,artifact_id));`);
}
