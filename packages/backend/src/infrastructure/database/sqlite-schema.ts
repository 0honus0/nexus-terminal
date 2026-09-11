// packages/backend/src/schema.ts

export const createSettingsTableSQL = `
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

export const createSettingsMigrationsTableSQL = `
CREATE TABLE IF NOT EXISTS settings_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

export const createAuditLogsTableSQL = `
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    action_type TEXT NOT NULL,
    details TEXT NULL
);
`;

// Passkeys table definition
export const createPasskeysTableSQL = `
CREATE TABLE IF NOT EXISTS passkeys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    credential_id TEXT UNIQUE NOT NULL, -- Base64URL encoded
    public_key TEXT NOT NULL, -- COSE public key, stored as Base64URL or HEX
    counter INTEGER NOT NULL,
    transports TEXT, -- JSON array of transports e.g. ["usb", "nfc", "ble", "internal"]
    name TEXT NULL, -- User-friendly name for the passkey
    backed_up BOOLEAN NOT NULL DEFAULT FALSE,
    last_used_at INTEGER NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const createNotificationSettingsTableSQL = `
CREATE TABLE IF NOT EXISTS notification_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_type TEXT NOT NULL CHECK(channel_type IN ('webhook', 'email', 'telegram')),
    name TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT false,
    config TEXT NOT NULL DEFAULT '{}', -- JSON string for channel-specific config
    enabled_events TEXT NOT NULL DEFAULT '[]', -- JSON array of event names
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

export const createUsersTableSQL = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    hashed_password TEXT NOT NULL,
    two_factor_secret TEXT NULL, -- 添加 2FA 密钥列，允许为空
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

export const createProxiesTableSQL = `
CREATE TABLE IF NOT EXISTS proxies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('SOCKS5', 'HTTP')),
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT NULL,
    auth_method TEXT NOT NULL DEFAULT 'none' CHECK(auth_method IN ('none', 'password', 'key')),
    encrypted_password TEXT NULL,
    encrypted_private_key TEXT NULL,
    encrypted_passphrase TEXT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(name, type, host, port)
);
`;

export const createConnectionsTableSQL = `
CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NULL, -- 允许 name 为空
    type TEXT NOT NULL CHECK(type IN ('SSH', 'RDP', 'VNC')) DEFAULT 'SSH',
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT NOT NULL,
    auth_method TEXT NOT NULL CHECK(auth_method IN ('password', 'key')),
    encrypted_password TEXT NULL,
    encrypted_private_key TEXT NULL,
    encrypted_passphrase TEXT NULL,
    proxy_id INTEGER NULL,
    ssh_key_id INTEGER NULL,
notes TEXT NULL,
jump_chain TEXT NULL,
rdp_options TEXT NULL,
proxy_type TEXT NULL,
created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    last_connected_at INTEGER NULL,
    FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL,
    FOREIGN KEY (ssh_key_id) REFERENCES ssh_keys(id) ON DELETE SET NULL
);
`;

export const createSshKeysTableSQL = `
CREATE TABLE IF NOT EXISTS ssh_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    encrypted_private_key TEXT NOT NULL,
    encrypted_passphrase TEXT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

export const createTagsTableSQL = `
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

export const createConnectionTagsTableSQL = `
CREATE TABLE IF NOT EXISTS connection_tags (
    connection_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (connection_id, tag_id),
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
`;

export const createIpBlacklistTableSQL = `
CREATE TABLE IF NOT EXISTS ip_blacklist (
    ip TEXT PRIMARY KEY NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 1,
    last_attempt_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    blocked_until INTEGER NULL -- 封禁截止时间戳 (秒)，NULL 表示未封禁或永久封禁 (根据逻辑决定)
);
`;

export const createCommandHistoryTableSQL = `
CREATE TABLE IF NOT EXISTS command_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    command TEXT NOT NULL,
    timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

export const createPathHistoryTableSQL = `
CREATE TABLE IF NOT EXISTS path_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

export const createQuickCommandsTableSQL = `
CREATE TABLE IF NOT EXISTS quick_commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NULL, -- 名称可选
    command TEXT NOT NULL, -- 指令必选
    usage_count INTEGER NOT NULL DEFAULT 0, -- 使用频率
    variables TEXT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

// --- Quick Command Tags ---

export const createQuickCommandTagsTableSQL = `
CREATE TABLE IF NOT EXISTS quick_command_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

export const createQuickCommandTagAssociationsTableSQL = `
CREATE TABLE IF NOT EXISTS quick_command_tag_associations (
    quick_command_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (quick_command_id, tag_id),
    FOREIGN KEY (quick_command_id) REFERENCES quick_commands(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES quick_command_tags(id) ON DELETE CASCADE
);
`;

// 从 database.ts 移动过来的，保持一致性
export const createTerminalThemesTableSQL = `
CREATE TABLE IF NOT EXISTS terminal_themes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    theme_type TEXT NOT NULL CHECK(theme_type IN ('preset', 'user')),
    foreground TEXT,
    background TEXT,
    cursor TEXT,
    cursor_accent TEXT,
    selection_background TEXT,
    black TEXT,
    red TEXT,
    green TEXT,
    yellow TEXT,
    blue TEXT,
    magenta TEXT,
    cyan TEXT,
    white TEXT,
    bright_black TEXT,
    bright_red TEXT,
    bright_green TEXT,
    bright_yellow TEXT,
    bright_blue TEXT,
    bright_magenta TEXT,
    bright_cyan TEXT,
    bright_white TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

export const createAppearanceSettingsTableSQL = `
CREATE TABLE IF NOT EXISTS appearance_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;
export const createFavoritePathsTableSQL = `
CREATE TABLE IF NOT EXISTS favorite_paths (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NULL,
    path TEXT NOT NULL,
    last_used_at INTEGER NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

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

export const createAiProvidersTableSQL = `
CREATE TABLE IF NOT EXISTS ai_providers (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('openai-compatible')),
    display_name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    protected_credential TEXT,
    credential_revision INTEGER NOT NULL DEFAULT 1 CHECK(credential_revision > 0),
    models_json TEXT NOT NULL CHECK(json_valid(models_json)),
    endpoint_policy_json TEXT NOT NULL CHECK(json_valid(endpoint_policy_json)),
    enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
    deleted_at INTEGER,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_providers_user_list ON ai_providers(user_id, deleted_at, display_name, id);
`;

export const createAiArtifactsTableSQL = `
CREATE TABLE IF NOT EXISTS ai_artifacts (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    app_id TEXT NOT NULL,
    original_name TEXT NOT NULL,
    media_type TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    sha256 TEXT,
    size_bytes INTEGER NOT NULL DEFAULT 0 CHECK(size_bytes >= 0),
    reserved_bytes INTEGER NOT NULL CHECK(reserved_bytes >= 0),
    status TEXT NOT NULL CHECK(status IN ('staging','ready','deleting','deleted','unavailable')),
    retained INTEGER NOT NULL DEFAULT 0 CHECK(retained IN (0,1)),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    created_at INTEGER NOT NULL,
    ready_at INTEGER,
    expires_at INTEGER,
    deleted_at INTEGER,
    FOREIGN KEY(user_id, app_id) REFERENCES agent_apps(user_id, app_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ai_artifacts_scope ON ai_artifacts(user_id, app_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS ai_artifacts_gc ON ai_artifacts(status, retained, expires_at);
`;

export const createAgentQuotaUsageTableSQL = `
CREATE TABLE IF NOT EXISTS agent_quota_usage (
    scope_key TEXT PRIMARY KEY,
    limit_bytes INTEGER NOT NULL CHECK(limit_bytes >= 0),
    used_bytes INTEGER NOT NULL DEFAULT 0 CHECK(used_bytes >= 0),
    reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK(reserved_bytes >= 0),
    CHECK(used_bytes + reserved_bytes <= limit_bytes)
);
`;

export const createAiThreadsTableSQL = `
CREATE TABLE IF NOT EXISTS ai_threads (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    app_id TEXT NOT NULL,
    title TEXT NOT NULL,
    next_sequence INTEGER NOT NULL DEFAULT 1 CHECK(next_sequence >= 1),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(id, user_id, app_id),
    FOREIGN KEY(user_id, app_id) REFERENCES agent_apps(user_id, app_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ai_threads_list ON ai_threads(user_id, app_id, updated_at DESC, id DESC);
`;

export const createAgentRunsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    app_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    parent_run_id TEXT,
    status TEXT NOT NULL CHECK(status IN (
      'created','running','awaiting_approval','awaiting_budget','cancelling',
      'completed','completed_unverified','failed','cancelled','interrupted'
    )),
    goal_status TEXT NOT NULL CHECK(goal_status IN ('unknown','in_progress','satisfied','not_satisfied')),
    verification_status TEXT NOT NULL CHECK(verification_status IN ('not_started','verified','unverified','failed')),
    needs_reconciliation INTEGER NOT NULL DEFAULT 0 CHECK(needs_reconciliation IN (0,1)),
    budget_json TEXT NOT NULL CHECK(json_valid(budget_json)),
    definition_json TEXT NOT NULL CHECK(json_valid(definition_json)),
    plan_json TEXT NOT NULL CHECK(json_valid(plan_json)),
    usage_json TEXT NOT NULL CHECK(json_valid(usage_json)),
    active_execution_seconds INTEGER NOT NULL DEFAULT 0 CHECK(active_execution_seconds >= 0),
    active_execution_started_at INTEGER,
    executing_runtime_count INTEGER NOT NULL DEFAULT 0 CHECK(executing_runtime_count >= 0),
    next_event_sequence INTEGER NOT NULL DEFAULT 1 CHECK(next_event_sequence >= 1),
    consumed_input_sequence INTEGER NOT NULL DEFAULT 0,
    input_revision INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    updated_at INTEGER NOT NULL,
    UNIQUE(id, user_id, app_id),
    UNIQUE(id, thread_id, user_id, app_id),
    FOREIGN KEY(parent_run_id, user_id, app_id) REFERENCES agent_runs(id, user_id, app_id),
    FOREIGN KEY(thread_id, user_id, app_id) REFERENCES ai_threads(id, user_id, app_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_one_live_run ON agent_runs(thread_id)
WHERE status IN ('created','running','awaiting_approval','awaiting_budget','cancelling');
CREATE INDEX IF NOT EXISTS agent_runs_scope ON agent_runs(user_id, app_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS agent_runs_reconcile ON agent_runs(status, needs_reconciliation, updated_at);
`;

export const createAiThreadEntriesTableSQL = `
CREATE TABLE IF NOT EXISTS ai_thread_entries (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    app_id TEXT NOT NULL,
    run_id TEXT,
    sequence INTEGER NOT NULL CHECK(sequence >= 1),
    kind TEXT NOT NULL CHECK(kind IN ('user_input','assistant_message','tool_result','system_notice')),
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
    created_at INTEGER NOT NULL,
    UNIQUE(thread_id, sequence),
    FOREIGN KEY(thread_id, user_id, app_id) REFERENCES ai_threads(id, user_id, app_id) ON DELETE CASCADE,
    FOREIGN KEY(run_id, thread_id, user_id, app_id) REFERENCES agent_runs(id, thread_id, user_id, app_id)
);
CREATE INDEX IF NOT EXISTS ai_thread_entries_page ON ai_thread_entries(thread_id, sequence DESC);
`;

export const createAgentArtifactLinksTableSQL = `
CREATE TABLE IF NOT EXISTS agent_artifact_links (
    artifact_id TEXT NOT NULL REFERENCES ai_artifacts(id),
    run_id TEXT NOT NULL REFERENCES agent_runs(id),
    role TEXT NOT NULL CHECK(role IN ('input','output','evidence','checkpoint')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY(artifact_id, run_id, role)
);
`;

export const createAgentArtifactGrantsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_artifact_grants (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES ai_artifacts(id) ON DELETE CASCADE,
    receiver_user_id INTEGER NOT NULL,
    receiver_app_id TEXT NOT NULL,
    receiver_thread_id TEXT NOT NULL,
    receiver_run_id TEXT,
    scope_key TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role = 'input'),
    expires_at INTEGER,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL,
    UNIQUE(artifact_id, receiver_user_id, receiver_app_id, scope_key, role),
    FOREIGN KEY(receiver_thread_id, receiver_user_id, receiver_app_id)
      REFERENCES ai_threads(id, user_id, app_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_artifact_grants_active
ON agent_artifact_grants(artifact_id, receiver_user_id, receiver_app_id, revoked_at, expires_at);
`;

export const createAgentArtifactCleanupConfirmationsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_artifact_cleanup_confirmations (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    selection_json TEXT NOT NULL CHECK(json_valid(selection_json)),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_artifact_cleanup_expiry
ON agent_artifact_cleanup_confirmations(expires_at);
`;

export const createAiContextDigestsTableSQL = `
CREATE TABLE IF NOT EXISTS ai_context_digests (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
    from_sequence INTEGER NOT NULL,
    to_sequence INTEGER NOT NULL CHECK(to_sequence >= from_sequence),
    source_hash TEXT NOT NULL,
    model_config_version TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(thread_id, from_sequence, to_sequence, source_hash, model_config_version)
);
`;

export const createAiMemoriesTableSQL = `
CREATE TABLE IF NOT EXISTS ai_memories (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    app_id TEXT NOT NULL,
    content TEXT NOT NULL,
    source_refs_json TEXT NOT NULL CHECK(json_valid(source_refs_json)),
    confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
    status TEXT NOT NULL CHECK(status IN ('candidate','published','revoked')),
    expires_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(user_id, app_id) REFERENCES agent_apps(user_id, app_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ai_memories_recall ON ai_memories(user_id, app_id, status, updated_at DESC, id DESC);
`;

export const createAgentRuntimesTableSQL = `
CREATE TABLE IF NOT EXISTS agent_runtimes (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL,
    backend_kind TEXT NOT NULL CHECK(backend_kind IN ('native','acp')),
    model_ref_json TEXT NOT NULL CHECK(json_valid(model_ref_json)),
    status TEXT NOT NULL CHECK(status IN ('created','running','stopping','stopped','failed','interrupted')),
    execution_owner_id TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(run_id, participant_id),
    UNIQUE(id, run_id)
);
`;

export const createAgentStepsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_steps (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    agent_runtime_id TEXT NOT NULL,
    step_index INTEGER NOT NULL CHECK(step_index >= 1),
    kind TEXT NOT NULL CHECK(kind IN ('model','tool','verification','delegation')),
    status TEXT NOT NULL CHECK(status IN ('created','running','completed','failed','cancelled')),
    input_watermark INTEGER NOT NULL,
    input_refs_json TEXT NOT NULL CHECK(json_valid(input_refs_json)),
    output_refs_json TEXT NOT NULL CHECK(json_valid(output_refs_json)),
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    UNIQUE(run_id, step_index),
    UNIQUE(id, run_id),
    FOREIGN KEY(agent_runtime_id, run_id) REFERENCES agent_runtimes(id, run_id) ON DELETE CASCADE
);
`;

export const createAgentModelAttemptsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_model_attempts (
    id TEXT PRIMARY KEY,
    step_id TEXT NOT NULL REFERENCES agent_steps(id) ON DELETE CASCADE,
    attempt_index INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('planned','reserved','streaming','completed','failed','aborted')),
    reserved_tokens INTEGER NOT NULL CHECK(reserved_tokens >= 0),
    input_tokens INTEGER,
    output_tokens INTEGER,
    cached_input_tokens INTEGER,
    cost_micros INTEGER,
    price_version TEXT,
    estimated INTEGER NOT NULL DEFAULT 0 CHECK(estimated IN (0,1)),
    error_code TEXT,
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    UNIQUE(step_id, attempt_index)
);
`;

export const createAgentToolCallsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_tool_calls (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    agent_runtime_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    provider_call_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    tool_version TEXT NOT NULL,
    inspection_json TEXT NOT NULL CHECK(json_valid(inspection_json)),
    operation_hash TEXT NOT NULL,
    operation_hash_version INTEGER NOT NULL CHECK(operation_hash_version = 1),
    risk TEXT NOT NULL CHECK(risk IN ('read','mutate','destructive')),
    status TEXT NOT NULL CHECK(status IN (
      'proposed','awaiting_approval','ready','running','succeeded','verification_failed','failed','cancelled','reconciling'
    )),
    result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    UNIQUE(step_id, provider_call_id),
    UNIQUE(step_id, operation_hash),
    UNIQUE(id, run_id),
    FOREIGN KEY(step_id, run_id) REFERENCES agent_steps(id, run_id) ON DELETE CASCADE,
    FOREIGN KEY(agent_runtime_id, run_id) REFERENCES agent_runtimes(id, run_id) ON DELETE CASCADE
);
`;

export const createAgentEventsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_events (
    event_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK(sequence >= 1),
    schema_version INTEGER NOT NULL CHECK(schema_version = 1),
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
    occurred_at INTEGER NOT NULL,
    UNIQUE(run_id, sequence)
);
CREATE INDEX IF NOT EXISTS agent_events_page ON agent_events(run_id, sequence);
`;

export const createAgentHostEventsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_host_cursors (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    next_sequence INTEGER NOT NULL DEFAULT 1 CHECK(next_sequence >= 1)
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

export const createAgentCommandsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_commands (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    app_id TEXT NOT NULL,
    command_name TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','committed','unknown')),
    response_status INTEGER,
    response_json TEXT CHECK(response_json IS NULL OR json_valid(response_json)),
    result_entity_id TEXT,
    generation INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    expires_at INTEGER,
    UNIQUE(user_id, app_id, command_name, idempotency_key)
);
CREATE INDEX IF NOT EXISTS agent_commands_cleanup ON agent_commands(status, expires_at);
`;

export const createAgentCheckpointsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_checkpoints (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    schema_version INTEGER NOT NULL CHECK(schema_version = 1),
    ledger_through INTEGER NOT NULL,
    event_through INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
    created_at INTEGER NOT NULL
);
`;

export const createAgentApprovalsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_approvals (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    app_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    tool_call_id TEXT NOT NULL,
    requested_by_runtime_id TEXT NOT NULL,
    operation_hash TEXT NOT NULL,
    operation_hash_version INTEGER NOT NULL CHECK(operation_hash_version = 1),
    status TEXT NOT NULL CHECK(status IN ('requested','approved','denied','expired','superseded')),
    policy_revision INTEGER NOT NULL CHECK(policy_revision > 0),
    input_revision INTEGER NOT NULL CHECK(input_revision >= 0),
    decided_by_user_id INTEGER REFERENCES users(id),
    decided_at INTEGER,
    consumed_at INTEGER,
    requested_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    FOREIGN KEY(run_id, user_id, app_id) REFERENCES agent_runs(id, user_id, app_id) ON DELETE CASCADE,
    FOREIGN KEY(tool_call_id, run_id) REFERENCES agent_tool_calls(id, run_id) ON DELETE CASCADE,
    FOREIGN KEY(requested_by_runtime_id, run_id) REFERENCES agent_runtimes(id, run_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_one_active_approval ON agent_approvals(tool_call_id)
    WHERE status = 'requested' OR (status = 'approved' AND consumed_at IS NULL);
CREATE INDEX IF NOT EXISTS agent_approval_expiry ON agent_approvals(status, expires_at);
CREATE INDEX IF NOT EXISTS agent_approval_scope ON agent_approvals(user_id, app_id, run_id, requested_at);
`;

export const createAgentResourceFencesTableSQL = `
CREATE TABLE IF NOT EXISTS agent_resource_fences (
    resource_key TEXT PRIMARY KEY,
    next_fence INTEGER NOT NULL DEFAULT 1 CHECK(next_fence >= 1)
);
`;

export const createAgentLeasesTableSQL = `
CREATE TABLE IF NOT EXISTS agent_leases (
    id TEXT PRIMARY KEY,
    resource_key TEXT NOT NULL REFERENCES agent_resource_fences(resource_key) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK(mode IN ('read','write')),
    owner_type TEXT NOT NULL CHECK(owner_type IN ('agent','workspace','system')),
    owner_id TEXT NOT NULL,
    fence INTEGER NOT NULL CHECK(fence >= 1),
    acquired_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    active_mutation INTEGER NOT NULL DEFAULT 0 CHECK(active_mutation IN (0,1)),
    operation_id TEXT
);
CREATE INDEX IF NOT EXISTS agent_lease_conflicts ON agent_leases(resource_key, expires_at, mode);
CREATE UNIQUE INDEX IF NOT EXISTS agent_lease_owner ON agent_leases(resource_key, owner_type, owner_id);
`;

export const createAgentResourceQuarantineTableSQL = `
CREATE TABLE IF NOT EXISTS agent_resource_quarantine (
    resource_key TEXT PRIMARY KEY REFERENCES agent_resource_fences(resource_key) ON DELETE CASCADE,
    tool_call_id TEXT REFERENCES agent_tool_calls(id) ON DELETE SET NULL,
    owner_type TEXT NOT NULL CHECK(owner_type IN ('agent','workspace','system')),
    owner_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    created_at INTEGER NOT NULL
);
`;

export const createAgentIntegrationsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_integrations (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    app_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('mcp','acp')),
    configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),
    protected_credential TEXT,
    credential_revision INTEGER NOT NULL DEFAULT 1 CHECK(credential_revision > 0),
    schema_hash TEXT,
    enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(id, user_id, app_id),
    FOREIGN KEY(user_id, app_id) REFERENCES agent_apps(user_id, app_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_integrations_scope
ON agent_integrations(user_id, app_id, kind, enabled, updated_at DESC, id);
`;

export const createAgentDelegationsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_delegations (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    parent_runtime_id TEXT NOT NULL,
    child_runtime_id TEXT NOT NULL UNIQUE,
    profile_id TEXT NOT NULL,
    capabilities_json TEXT NOT NULL CHECK(json_valid(capabilities_json)),
    peer_messaging TEXT NOT NULL CHECK(peer_messaging IN ('parent-child','same-run')),
    model_ref_json TEXT NOT NULL CHECK(json_valid(model_ref_json)),
    objective TEXT NOT NULL,
    constraints_json TEXT NOT NULL CHECK(json_valid(constraints_json)),
    input_artifact_refs_json TEXT NOT NULL CHECK(json_valid(input_artifact_refs_json)),
    completion_criteria_json TEXT NOT NULL CHECK(json_valid(completion_criteria_json)),
    dependency_mode TEXT NOT NULL CHECK(dependency_mode IN ('success','settled')),
    status TEXT NOT NULL CHECK(status IN ('queued','running','waiting','completed','failed','cancelled')),
    depth INTEGER NOT NULL CHECK(depth >= 1),
    failure_mode TEXT NOT NULL CHECK(failure_mode IN ('isolate','failFast')),
    max_tokens INTEGER NOT NULL CHECK(max_tokens > 0),
    max_steps INTEGER NOT NULL CHECK(max_steps > 0),
    reserved_tokens INTEGER NOT NULL DEFAULT 0 CHECK(reserved_tokens >= 0),
    reserved_steps INTEGER NOT NULL DEFAULT 0 CHECK(reserved_steps >= 0),
    used_tokens INTEGER NOT NULL DEFAULT 0 CHECK(used_tokens >= 0),
    used_steps INTEGER NOT NULL DEFAULT 0 CHECK(used_steps >= 0),
    result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
    evidence_refs_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(evidence_refs_json)),
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    deadline_at INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    UNIQUE(run_id, parent_runtime_id, idempotency_key),
    FOREIGN KEY(parent_runtime_id, run_id) REFERENCES agent_runtimes(id, run_id) ON DELETE CASCADE,
    FOREIGN KEY(child_runtime_id, run_id) REFERENCES agent_runtimes(id, run_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_delegations_run ON agent_delegations(run_id, parent_runtime_id, created_at, id);
CREATE INDEX IF NOT EXISTS agent_delegations_status ON agent_delegations(run_id, status, deadline_at);
`;

export const createAgentMailboxCursorsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_mailbox_cursors (
    recipient_runtime_id TEXT PRIMARY KEY REFERENCES agent_runtimes(id) ON DELETE CASCADE,
    next_sequence INTEGER NOT NULL DEFAULT 1 CHECK(next_sequence >= 1)
);
`;

export const createAgentMessagesTableSQL = `
CREATE TABLE IF NOT EXISTS agent_messages (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    sender_runtime_id TEXT NOT NULL,
    recipient_runtime_id TEXT NOT NULL,
    delegation_id TEXT NOT NULL REFERENCES agent_delegations(id) ON DELETE CASCADE,
    recipient_sequence INTEGER NOT NULL CHECK(recipient_sequence >= 1),
    kind TEXT NOT NULL CHECK(kind IN ('request','reply','progress','evidence','completion')),
    idempotency_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    reply_to TEXT REFERENCES agent_messages(id),
    causation_id TEXT REFERENCES agent_messages(id),
    task_revision INTEGER NOT NULL CHECK(task_revision >= 0),
    body_json TEXT NOT NULL CHECK(json_valid(body_json)),
    artifact_refs_json TEXT NOT NULL CHECK(json_valid(artifact_refs_json)),
    size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
    status TEXT NOT NULL CHECK(status IN ('accepted','delivered','consumed','expired','rejected')),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER,
    UNIQUE(recipient_runtime_id, recipient_sequence),
    UNIQUE(run_id, sender_runtime_id, recipient_runtime_id, idempotency_key),
    FOREIGN KEY(sender_runtime_id, run_id) REFERENCES agent_runtimes(id, run_id) ON DELETE CASCADE,
    FOREIGN KEY(recipient_runtime_id, run_id) REFERENCES agent_runtimes(id, run_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_messages_pending
ON agent_messages(recipient_runtime_id, status, recipient_sequence);
CREATE INDEX IF NOT EXISTS agent_messages_run ON agent_messages(run_id, created_at, id);
`;

export const createAgentSchedulerWorkTableSQL = `
CREATE TABLE IF NOT EXISTS agent_scheduler_work (
    enqueue_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    agent_runtime_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('model_step','tool_step','consume_inbox','verify','join_resume')),
    status TEXT NOT NULL CHECK(status IN ('queued','claimed','waiting','completed','cancelled')),
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
    owner_epoch INTEGER,
    not_before INTEGER NOT NULL,
    deadline_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    FOREIGN KEY(agent_runtime_id, run_id) REFERENCES agent_runtimes(id, run_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_work_ready
ON agent_scheduler_work(status, not_before, enqueue_sequence);
CREATE INDEX IF NOT EXISTS agent_work_runtime ON agent_scheduler_work(agent_runtime_id, status, enqueue_sequence);
`;

export const createAgentDelegationEdgesTableSQL = `
CREATE TABLE IF NOT EXISTS agent_delegation_edges (
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    delegation_id TEXT NOT NULL REFERENCES agent_delegations(id) ON DELETE CASCADE,
    depends_on_id TEXT NOT NULL REFERENCES agent_delegations(id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK(mode IN ('success','settled')),
    PRIMARY KEY(delegation_id, depends_on_id),
    CHECK(delegation_id <> depends_on_id)
);
CREATE INDEX IF NOT EXISTS agent_delegation_edges_run ON agent_delegation_edges(run_id, delegation_id);
`;

export const createAgentSharedFactsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_shared_facts (
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL CHECK(json_valid(value_json)),
    bytes INTEGER NOT NULL CHECK(bytes >= 0),
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    updated_by_runtime_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(run_id, key),
    FOREIGN KEY(updated_by_runtime_id, run_id) REFERENCES agent_runtimes(id, run_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_shared_facts_run ON agent_shared_facts(run_id, updated_at DESC, key);
`;

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
    artifact_app_id TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
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

export const createAgentPluginVersionsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_plugin_versions (
    app_id TEXT NOT NULL,
    version TEXT NOT NULL,
    package_hash TEXT NOT NULL,
    publisher_key_id TEXT NOT NULL,
    manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
    frontend_entry TEXT,
    backend_entry TEXT,
    runner_entry TEXT,
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

export const createAgentMemoryImportConfirmationsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_memory_import_confirmations (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_app_id TEXT NOT NULL,
    source_memory_id TEXT NOT NULL,
    target_app_id TEXT NOT NULL,
    source_version INTEGER NOT NULL CHECK(source_version > 0),
    snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    UNIQUE(id, user_id, target_app_id)
);
CREATE INDEX IF NOT EXISTS agent_memory_import_confirmation_expiry
ON agent_memory_import_confirmations(expires_at);
`;

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
    limits_json TEXT NOT NULL CHECK(json_valid(limits_json)),
    network_json TEXT NOT NULL CHECK(json_valid(network_json)),
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
