// Frozen published database migration dependency. Not an application API.
import type { SqlExecutor } from '../../../../../../../sql-types.js';

/** Deleting an App cannot atomically delete its filesystem objects with SQLite. */
export async function initializeArtifactBlobRemovals(tx: SqlExecutor): Promise<void> {
	await tx.exec('CREATE TABLE agent_artifact_blob_removals(id TEXT PRIMARY KEY) STRICT;');
}
