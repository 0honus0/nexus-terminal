import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeAgentProviders(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
 CREATE TABLE agent_providers(
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
  display_name TEXT NOT NULL,base_url TEXT NOT NULL,
  protocol TEXT NOT NULL CHECK(protocol IN ('chat-completions','responses')),
  models_json TEXT NOT NULL,
  observations_json TEXT NOT NULL DEFAULT '[]',
  protected_credential TEXT,
  credential_revision INTEGER NOT NULL CHECK(credential_revision>=1),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  version INTEGER NOT NULL CHECK(version>=1),
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
 );
 CREATE INDEX agent_providers_owner ON agent_providers(user_id,deleted_at,display_name);
 CREATE TABLE agent_run_frozen_inputs(
  run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES agent_providers(id),
  provider_version INTEGER NOT NULL CHECK(provider_version>=1),
  credential_revision INTEGER NOT NULL CHECK(credential_revision>=1),
  model_id TEXT NOT NULL,base_url TEXT NOT NULL,
  protocol TEXT NOT NULL CHECK(protocol IN ('chat-completions','responses')),
  capabilities_json TEXT NOT NULL,
  execution_policy TEXT NOT NULL CHECK(execution_policy='governed')
 );
 CREATE INDEX agent_frozen_by_provider ON agent_run_frozen_inputs(provider_id,run_id);
 `);
}
