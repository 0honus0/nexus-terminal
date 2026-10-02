export const createAgentWorkspacesTableSQL = `
CREATE TABLE IF NOT EXISTS agent_workspaces (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    app_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    agent_runtime_id TEXT NOT NULL,
    retained INTEGER NOT NULL DEFAULT 0 CHECK(retained IN (0,1)),
    kind TEXT NOT NULL CHECK(kind IN ('shell','code','data','browser')),
    recipe_id TEXT NOT NULL,
    recipe_revision TEXT NOT NULL,
    runtime_digest TEXT NOT NULL,
    catalog_revision TEXT NOT NULL,
    toolchain_json TEXT NOT NULL CHECK(json_valid(toolchain_json)),
    runner_plugins_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(runner_plugins_json)),
    generation INTEGER NOT NULL DEFAULT 1 CHECK(generation >= 1),
    status TEXT NOT NULL CHECK(status IN ('creating','ready','starting','running','stopping','stopped','deleting','deleted','failed')),
    acp_profiles_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(acp_profiles_json)),
    browser_target_json TEXT CHECK(browser_target_json IS NULL OR json_valid(browser_target_json)),
    retained_manifest_ref TEXT REFERENCES ai_artifacts(id) ON DELETE SET NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    last_active_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(id, user_id, app_id),
    FOREIGN KEY(run_id, user_id, app_id) REFERENCES agent_runs(id, user_id, app_id) ON DELETE CASCADE,
    FOREIGN KEY(agent_runtime_id, run_id) REFERENCES agent_runtimes(id, run_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_workspaces_scope ON agent_workspaces(user_id, app_id, run_id, updated_at);
CREATE INDEX IF NOT EXISTS agent_workspaces_runtime ON agent_workspaces(agent_runtime_id, run_id, status);
CREATE INDEX IF NOT EXISTS agent_workspaces_status ON agent_workspaces(status, last_active_at);
`;

export const createAgentWorkspaceRuntimeCommandsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_workspace_runtime_commands (
    id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES agent_workspaces(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app_id TEXT NOT NULL,
    action TEXT NOT NULL,
    operation_hash TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK(generation >= 1),
    status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed','unknown')),
    request_json TEXT NOT NULL CHECK(json_valid(request_json)),
    result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
    deadline_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    UNIQUE(user_id, app_id, action, operation_hash)
);
CREATE INDEX IF NOT EXISTS agent_workspace_runtime_commands_scope ON agent_workspace_runtime_commands(user_id, app_id, status, created_at);
CREATE INDEX IF NOT EXISTS agent_workspace_runtime_commands_pending ON agent_workspace_runtime_commands(status, deadline_at);
`;

export const createAgentWorkspaceRuntimeConfirmationsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_workspace_runtime_confirmations (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('setup','packUninstall','runtimeCleanup','settingsReset')),
    expected_settings_revision INTEGER NOT NULL CHECK(expected_settings_revision > 0),
    catalog_revision TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
    snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_workspace_runtime_confirmations_expiry ON agent_workspace_runtime_confirmations(expires_at);
`;

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
