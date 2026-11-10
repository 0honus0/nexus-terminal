// Frozen published database migration dependency. Not an application API.
import type { SqlExecutor } from '../../../../../../../sql-types.js';

/** Retain a terminal outcome for an original key even when no connection was created. */
export async function initializeIntegrationCreationRejections(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_integration_rejections(
 user_id INTEGER NOT NULL,app_id TEXT NOT NULL,operation_key TEXT NOT NULL,intent_hash TEXT NOT NULL,
 PRIMARY KEY(user_id,app_id,operation_key),
 FOREIGN KEY(app_id,user_id) REFERENCES agent_apps(id,user_id) ON DELETE CASCADE);`);
}
