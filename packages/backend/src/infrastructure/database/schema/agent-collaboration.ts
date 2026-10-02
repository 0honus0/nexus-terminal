export const createAgentDelegationsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_delegations (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    parent_runtime_id TEXT NOT NULL,
    child_runtime_id TEXT NOT NULL UNIQUE,
    profile_id TEXT NOT NULL,
    grants_json TEXT NOT NULL CHECK(json_valid(grants_json)),
    peer_messaging TEXT NOT NULL CHECK(peer_messaging IN ('parent-child','same-run')),
    mutation_mode TEXT NOT NULL DEFAULT 'read-only' CHECK(mutation_mode IN ('read-only','governed')),
    model_ref_json TEXT NOT NULL CHECK(json_valid(model_ref_json)),
    objective TEXT NOT NULL,
    constraints_json TEXT NOT NULL CHECK(json_valid(constraints_json)),
    input_artifact_refs_json TEXT NOT NULL CHECK(json_valid(input_artifact_refs_json)),
    completion_criteria_json TEXT NOT NULL CHECK(json_valid(completion_criteria_json)),
    dependency_mode TEXT NOT NULL CHECK(dependency_mode IN ('success','settled')),
    status TEXT NOT NULL CHECK(status IN ('queued','running','waiting','completed','failed','cancelled')),
    depth INTEGER NOT NULL CHECK(depth >= 1),
    failure_mode TEXT NOT NULL CHECK(failure_mode IN ('isolate','failFast')),
    max_steps INTEGER NOT NULL CHECK(max_steps > 0),
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
export const createAgentRuntimeContextCheckpointsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_runtime_context_checkpoints (
  runtime_id TEXT PRIMARY KEY REFERENCES agent_runtimes(id) ON DELETE CASCADE,
  checkpoint_json TEXT NOT NULL CHECK(json_valid(checkpoint_json))
);
`;
