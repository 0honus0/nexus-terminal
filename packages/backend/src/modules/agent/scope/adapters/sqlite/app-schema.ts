import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeAppDeclarations(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
 CREATE TABLE agent_app_definitions(
  id TEXT NOT NULL,version TEXT NOT NULL,display_name TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  PRIMARY KEY(id,version)
 );
 CREATE TABLE agent_app_declared_capabilities(
  definition_id TEXT NOT NULL,definition_version TEXT NOT NULL,capability TEXT NOT NULL,
  PRIMARY KEY(definition_id,definition_version,capability),
  FOREIGN KEY(definition_id,definition_version) REFERENCES agent_app_definitions(id,version) ON DELETE CASCADE
 );
 `);
}
