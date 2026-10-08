export const createAgentProjectDirectoriesTableSQL = `
CREATE TABLE IF NOT EXISTS agent_project_directories (
  user_id INTEGER NOT NULL,
  app_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  connection_id INTEGER NOT NULL,
  directory TEXT NOT NULL,
  configuration_hash TEXT NOT NULL,
  PRIMARY KEY (user_id, app_id, thread_id, connection_id)
);
`;

export const createAgentSshJobsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_ssh_jobs (
  job_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  app_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  connection_id INTEGER NOT NULL,
  configuration_hash TEXT NOT NULL,
  session_id TEXT NOT NULL,
  operation_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','unknown','cancelled')),
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE(user_id, app_id, operation_hash)
);
`;
