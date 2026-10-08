export const createAgentPublisherKeysTableSQL = `
CREATE TABLE IF NOT EXISTS agent_publisher_keys (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_id TEXT NOT NULL,
    public_key_pem TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER,
    PRIMARY KEY(user_id, key_id)
);
CREATE INDEX IF NOT EXISTS agent_publisher_keys_active ON agent_publisher_keys(user_id, revoked_at, created_at DESC);
`;

export const createAgentPluginStagesTableSQL = `
CREATE TABLE IF NOT EXISTS agent_plugin_stages (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_kind TEXT NOT NULL CHECK(source_kind IN ('artifact','remote')),
    source_json TEXT NOT NULL CHECK(json_valid(source_json)),
    package_hash TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
    publisher_key_id TEXT,
    app_id TEXT,
    app_version TEXT,
    manifest_json TEXT CHECK(manifest_json IS NULL OR json_valid(manifest_json)),
    status TEXT NOT NULL CHECK(status IN ('staged','verified','failed','installed')),
    error_code TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    UNIQUE(user_id, id)
);
CREATE INDEX IF NOT EXISTS agent_plugin_stages_user ON agent_plugin_stages(user_id, created_at DESC, id DESC);
`;

export const createAgentPluginPendingUpgradesTableSQL = `
CREATE TABLE IF NOT EXISTS agent_plugin_pending_upgrades (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app_id TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    from_version TEXT NOT NULL,
    target_version TEXT NOT NULL,
    package_hash TEXT NOT NULL,
    app_state_version INTEGER NOT NULL CHECK(app_state_version > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(user_id, app_id),
    FOREIGN KEY(user_id, app_id) REFERENCES agent_apps(user_id, app_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_plugin_pending_upgrades_user
ON agent_plugin_pending_upgrades(user_id, updated_at DESC, app_id);
`;

export const createAgentPluginVersionsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_plugin_versions (
    app_id TEXT NOT NULL,
    version TEXT NOT NULL,
    package_hash TEXT NOT NULL,
    publisher_key_id TEXT NOT NULL,
    manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
    frontend_entry TEXT,
    backend_entry TEXT,
    skill_files_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(skill_files_json)),
    status TEXT NOT NULL CHECK(status IN ('verified','installed','failed','removed')),
    installed_at INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(app_id, version)
);
CREATE INDEX IF NOT EXISTS agent_plugin_versions_status ON agent_plugin_versions(status, app_id, version);
`;

export const createAgentPluginInstallationsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_plugin_installations (
    user_id INTEGER NOT NULL,
    app_id TEXT NOT NULL,
    version TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('installed','removed')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(user_id, app_id),
    FOREIGN KEY(user_id, app_id) REFERENCES agent_apps(user_id, app_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_plugin_installations_version ON agent_plugin_installations(app_id, version, status);
`;

export const createAgentAppIntentReceiptsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_app_intent_receipts (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_app_id TEXT NOT NULL,
    receiver_app_id TEXT NOT NULL,
    intent_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL CHECK(schema_version > 0),
    input_json TEXT NOT NULL CHECK(json_valid(input_json)),
    artifact_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(artifact_ids_json)),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    CHECK(sender_app_id <> receiver_app_id),
    UNIQUE(id, user_id)
);
CREATE INDEX IF NOT EXISTS agent_app_intent_receipts_receiver
ON agent_app_intent_receipts(user_id, receiver_app_id, revoked_at, expires_at, created_at DESC);
`;

export const createAgentAppIntentArtifactGrantsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_app_intent_artifact_grants (
    id TEXT PRIMARY KEY,
    receipt_id TEXT NOT NULL REFERENCES agent_app_intent_receipts(id) ON DELETE CASCADE,
    artifact_id TEXT NOT NULL REFERENCES ai_artifacts(id) ON DELETE CASCADE,
    receiver_user_id INTEGER NOT NULL,
    receiver_app_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    UNIQUE(receipt_id, artifact_id)
);
CREATE INDEX IF NOT EXISTS agent_app_intent_artifact_grants_active
ON agent_app_intent_artifact_grants(artifact_id, receiver_user_id, receiver_app_id, revoked_at, expires_at);
`;
