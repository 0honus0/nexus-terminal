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
    live_capabilities_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(live_capabilities_json)),
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

export const createAgentArtifactLinksTableSQL = `
CREATE TABLE IF NOT EXISTS agent_artifact_links (
    artifact_id TEXT NOT NULL REFERENCES ai_artifacts(id),
    run_id TEXT NOT NULL REFERENCES agent_runs(id),
    role TEXT NOT NULL CHECK(role IN ('input','output','evidence','checkpoint')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY(artifact_id, run_id, role)
);
CREATE TRIGGER IF NOT EXISTS agent_artifact_links_run_quota_insert
BEFORE INSERT ON agent_artifact_links
WHEN NOT EXISTS (
  SELECT 1 FROM agent_artifact_links existing
  WHERE existing.artifact_id = NEW.artifact_id AND existing.run_id = NEW.run_id
)
AND (
  COALESCE((
    SELECT SUM(a.size_bytes)
    FROM ai_artifacts a
    WHERE a.id IN (
      SELECT DISTINCT existing.artifact_id
      FROM agent_artifact_links existing
      WHERE existing.run_id = NEW.run_id
    )
      AND a.status <> 'deleted'
  ), 0)
  + COALESCE((
    SELECT CASE WHEN incoming.status = 'staging' THEN incoming.reserved_bytes ELSE incoming.size_bytes END
    FROM ai_artifacts incoming
    WHERE incoming.id = NEW.artifact_id AND incoming.status <> 'deleted'
  ), 0)
) > COALESCE((
  SELECT MIN(
    COALESCE(CAST(json_extract(s.value_json, '$.storage.maxArtifactBytes') AS INTEGER), 268435456),
    COALESCE(CAST(json_extract(s.value_json, '$.hardLimits.maxArtifactBytes') AS INTEGER), 1073741824)
  )
  FROM agent_runs r
  LEFT JOIN agent_settings s ON s.user_id = r.user_id
  WHERE r.id = NEW.run_id
), 268435456)
BEGIN
  SELECT RAISE(ABORT, 'ARTIFACT_RUN_QUOTA_EXCEEDED');
END;
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

export const createAiContextCheckpointsTableSQL = `
CREATE TABLE IF NOT EXISTS ai_context_checkpoints (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
    visibility_hash TEXT NOT NULL,
    visibility_json TEXT NOT NULL CHECK(json_valid(visibility_json)),
    from_sequence INTEGER NOT NULL CHECK(from_sequence >= 1),
    to_sequence INTEGER NOT NULL CHECK(to_sequence >= from_sequence),
    source_hash TEXT NOT NULL,
    strategy_version TEXT NOT NULL,
    generator_json TEXT NOT NULL CHECK(json_valid(generator_json)),
    source_tokens INTEGER NOT NULL CHECK(source_tokens >= 0),
    summary_tokens INTEGER NOT NULL CHECK(summary_tokens >= 0),
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(thread_id, visibility_hash, from_sequence, to_sequence, strategy_version)
);
CREATE INDEX IF NOT EXISTS ai_context_checkpoints_thread_range
ON ai_context_checkpoints(thread_id, visibility_hash, to_sequence DESC);
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
    proposed_by_runtime_id TEXT,
    review_action TEXT CHECK(review_action IS NULL OR review_action IN ('publish','reject','revoke')),
    reviewed_at INTEGER,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(user_id, app_id) REFERENCES agent_apps(user_id, app_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ai_memories_recall ON ai_memories(user_id, app_id, status, updated_at DESC, id DESC);
`;

export const createAiMemorySearchIndexSQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS ai_memories_search USING fts5(
    terms,
    tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS ai_memories_search_insert
AFTER INSERT ON ai_memories
BEGIN
  INSERT INTO ai_memories_search(rowid, terms)
  VALUES (NEW.rowid, nexus_search_terms(NEW.content));
END;
CREATE TRIGGER IF NOT EXISTS ai_memories_search_update
AFTER UPDATE OF content ON ai_memories
BEGIN
  DELETE FROM ai_memories_search WHERE rowid = OLD.rowid;
  INSERT INTO ai_memories_search(rowid, terms)
  VALUES (NEW.rowid, nexus_search_terms(NEW.content));
END;
CREATE TRIGGER IF NOT EXISTS ai_memories_search_delete
AFTER DELETE ON ai_memories
BEGIN
  DELETE FROM ai_memories_search WHERE rowid = OLD.rowid;
END;
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
