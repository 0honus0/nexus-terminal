import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeTargetDenylist(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
 CREATE TABLE agent_target_denylist_meta(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL CHECK(revision>=1));
 INSERT INTO agent_target_denylist_meta(id,revision) VALUES(1,1);
 CREATE TABLE agent_target_denylist(connection_id INTEGER PRIMARY KEY CHECK(connection_id>=1),connection_version INTEGER NOT NULL CHECK(connection_version>=1),reason TEXT NOT NULL,changed_by INTEGER NOT NULL REFERENCES access_accounts(id),changed_at INTEGER NOT NULL);
 `);
}
