import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeAppDeclarations(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
 CREATE TABLE agent_app_definitions(
  id TEXT NOT NULL,version TEXT NOT NULL,display_name TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  installed INTEGER NOT NULL CHECK(installed IN (0,1)),default_enabled INTEGER NOT NULL CHECK(default_enabled IN (0,1)),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('builtin','plugin')),
  PRIMARY KEY(id,version)
 );
 CREATE TABLE agent_app_declared_capabilities(
  definition_id TEXT NOT NULL,definition_version TEXT NOT NULL,capability TEXT NOT NULL,
  PRIMARY KEY(definition_id,definition_version,capability),
  FOREIGN KEY(definition_id,definition_version) REFERENCES agent_app_definitions(id,version) ON DELETE CASCADE
 );
 `);
}
