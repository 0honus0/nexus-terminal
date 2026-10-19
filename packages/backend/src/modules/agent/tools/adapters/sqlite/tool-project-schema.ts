import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export async function initializeToolProjects(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_run_projects (
		run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
		connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
		directory TEXT NOT NULL,
		target_version INTEGER NOT NULL,
		fingerprint TEXT NOT NULL,
		PRIMARY KEY(run_id,connection_id)
	);
	CREATE TABLE agent_project_effects (
		operation_id TEXT PRIMARY KEY REFERENCES agent_run_tools(id) ON DELETE CASCADE
	);`);
}
