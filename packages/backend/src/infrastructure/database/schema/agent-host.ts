export const createAgentAppsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_apps (
    user_id INTEGER NOT NULL REFERENCES users(id),
    app_id TEXT NOT NULL,
    active_version TEXT NOT NULL,
    desired_state TEXT NOT NULL CHECK(desired_state IN ('enabled','disabled')),
    observed_state TEXT NOT NULL CHECK(observed_state IN ('disabled','enabling','running','degraded','failed','disabling')),
    health_reason TEXT,
    policy_revision INTEGER NOT NULL DEFAULT 1 CHECK(policy_revision > 0),
    running_count INTEGER NOT NULL DEFAULT 0 CHECK(running_count >= 0),
    approval_count INTEGER NOT NULL DEFAULT 0 CHECK(approval_count >= 0),
    budget_request_count INTEGER NOT NULL DEFAULT 0 CHECK(budget_request_count >= 0),
    accept_new_runs INTEGER NOT NULL DEFAULT 1 CHECK(accept_new_runs IN (0,1)),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(user_id, app_id)
);
`;

export const createAgentAppGrantsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_app_grants (
    user_id INTEGER NOT NULL,
    app_id TEXT NOT NULL,
    capability TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK(schema_version > 0),
    scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
    granted_at INTEGER NOT NULL,
    PRIMARY KEY(user_id, app_id, capability),
    FOREIGN KEY(user_id, app_id) REFERENCES agent_apps(user_id, app_id) ON DELETE CASCADE
);
`;

export const createAgentAppStorageTableSQL = `
CREATE TABLE IF NOT EXISTS agent_app_storage (
    user_id INTEGER NOT NULL,
    app_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL CHECK(json_valid(value_json)),
    bytes INTEGER NOT NULL CHECK(bytes >= 0),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(user_id, app_id, key),
    FOREIGN KEY(user_id, app_id) REFERENCES agent_apps(user_id, app_id) ON DELETE CASCADE
);
`;

export const createAgentSettingsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    value_json TEXT NOT NULL CHECK(json_valid(value_json)),
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
    updated_at INTEGER NOT NULL
);
`;

export const createAgentHardLimitConfirmationsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_hard_limit_confirmations (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expected_revision INTEGER NOT NULL CHECK(expected_revision > 0),
    proposed_json TEXT NOT NULL CHECK(json_valid(proposed_json)),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_hard_limit_confirmations_expiry
ON agent_hard_limit_confirmations(user_id, expires_at);
`;

export const createAgentTargetDenylistTableSQL = `
CREATE TABLE IF NOT EXISTS agent_target_denylist (
    connection_id INTEGER PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    changed_by INTEGER NOT NULL REFERENCES users(id),
    changed_at INTEGER NOT NULL
);
`;

export const createAgentTargetDenylistMetaTableSQL = `
CREATE TABLE IF NOT EXISTS agent_target_denylist_meta (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    revision INTEGER NOT NULL CHECK(revision > 0),
    updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO agent_target_denylist_meta (id, revision, updated_at) VALUES (1, 1, 0);
`;

export const createAgentHostEventsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_host_cursors (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    next_sequence INTEGER NOT NULL DEFAULT 1 CHECK(next_sequence >= 1),
    oldest_cursor INTEGER NOT NULL DEFAULT 0 CHECK(oldest_cursor >= 0)
);
CREATE TABLE IF NOT EXISTS agent_host_events (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK(sequence >= 1),
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
    occurred_at INTEGER NOT NULL,
    PRIMARY KEY(user_id, sequence)
);
`;
