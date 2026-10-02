export const createAiThreadsTableSQL = `
CREATE TABLE IF NOT EXISTS ai_threads (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    app_id TEXT NOT NULL,
    title TEXT NOT NULL,
    title_source TEXT NOT NULL DEFAULT 'placeholder' CHECK(title_source IN ('placeholder','auto','manual')),
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
      'created','running','awaiting_approval','awaiting_budget','awaiting_input','cancelling',
      'completed','completed_unverified','failed','cancelled','interrupted'
    )),
    goal_status TEXT NOT NULL CHECK(goal_status IN ('unknown','in_progress','satisfied','not_satisfied')),
    goal_text TEXT,
    goal_revision INTEGER NOT NULL DEFAULT 0 CHECK(goal_revision >= 0),
    goal_updated_at INTEGER,
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
WHERE status IN ('created','running','awaiting_approval','awaiting_budget','awaiting_input','cancelling');
CREATE INDEX IF NOT EXISTS agent_runs_scope ON agent_runs(user_id, app_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS agent_runs_reconcile ON agent_runs(status, needs_reconciliation, updated_at);
`;

export const createAgentLoopGuardsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_loop_guards (
    run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
    epoch INTEGER NOT NULL DEFAULT 1 CHECK(epoch > 0),
    trajectory_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(trajectory_json)),
    no_progress_count INTEGER NOT NULL DEFAULT 0 CHECK(no_progress_count >= 0),
    warning_level INTEGER NOT NULL DEFAULT 0 CHECK(warning_level BETWEEN 0 AND 2),
    paused_runtime_id TEXT,
    paused_delegation_id TEXT,
    last_reason TEXT,
    updated_at INTEGER NOT NULL
);
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

export const createAiThreadEntrySearchIndexSQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS ai_thread_entries_search USING fts5(
    terms,
    tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS ai_thread_entries_search_insert
AFTER INSERT ON ai_thread_entries
BEGIN
  INSERT INTO ai_thread_entries_search(rowid, terms)
  VALUES (NEW.rowid, nexus_ledger_search_terms(NEW.payload_json));
END;
CREATE TRIGGER IF NOT EXISTS ai_thread_entries_search_update
AFTER UPDATE OF payload_json ON ai_thread_entries
BEGIN
  DELETE FROM ai_thread_entries_search WHERE rowid = OLD.rowid;
  INSERT INTO ai_thread_entries_search(rowid, terms)
  VALUES (NEW.rowid, nexus_ledger_search_terms(NEW.payload_json));
END;
CREATE TRIGGER IF NOT EXISTS ai_thread_entries_search_delete
AFTER DELETE ON ai_thread_entries
BEGIN
  DELETE FROM ai_thread_entries_search WHERE rowid = OLD.rowid;
END;
`;

export const createAgentRuntimesTableSQL = `
CREATE TABLE IF NOT EXISTS agent_runtimes (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL,
    backend_kind TEXT NOT NULL CHECK(backend_kind IN ('native','acp')),
    model_ref_json TEXT NOT NULL CHECK(json_valid(model_ref_json)),
    status TEXT NOT NULL CHECK(status IN ('created','running','stopping','stopped','failed','interrupted')),
    schedule_state TEXT NOT NULL DEFAULT 'queued'
      CHECK(schedule_state IN ('queued','runnable','executing','waiting_message','waiting_approval','waiting_budget','joining','finished')),
    consumed_mailbox_sequence INTEGER NOT NULL DEFAULT 0 CHECK(consumed_mailbox_sequence >= 0),
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
    estimated INTEGER NOT NULL DEFAULT 0 CHECK(estimated IN (0,1)),
    continuation_json TEXT CHECK(continuation_json IS NULL OR json_valid(continuation_json)),
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
    source_model_step_id TEXT NOT NULL,
    batch_index INTEGER NOT NULL DEFAULT 0 CHECK(batch_index >= 0),
    batch_size INTEGER NOT NULL DEFAULT 1 CHECK(batch_size >= 1),
    provider_call_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    tool_version TEXT NOT NULL,
    inspection_json TEXT NOT NULL CHECK(json_valid(inspection_json)),
    operation_hash TEXT NOT NULL,
    operation_hash_version INTEGER NOT NULL CHECK(operation_hash_version = 1),
    risk TEXT NOT NULL CHECK(risk IN ('read','control','mutate','destructive','forbidden')),
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
    FOREIGN KEY(source_model_step_id, run_id) REFERENCES agent_steps(id, run_id) ON DELETE CASCADE,
    FOREIGN KEY(agent_runtime_id, run_id) REFERENCES agent_runtimes(id, run_id) ON DELETE CASCADE
);
`;

export const createAgentInputRequestsTableSQL = `
CREATE TABLE IF NOT EXISTS agent_input_requests (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    app_id TEXT NOT NULL,
    agent_runtime_id TEXT NOT NULL,
    tool_call_id TEXT NOT NULL UNIQUE REFERENCES agent_tool_calls(id) ON DELETE CASCADE,
    provider_call_id TEXT NOT NULL,
    questions_json TEXT NOT NULL CHECK(json_valid(questions_json)),
    continuation_json TEXT CHECK(continuation_json IS NULL OR json_valid(continuation_json)),
    status TEXT NOT NULL CHECK(status IN ('requested','answered','cancelled')),
    requested_at INTEGER NOT NULL,
    answered_at INTEGER,
    answer_entry_id TEXT,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
    FOREIGN KEY(run_id, user_id, app_id) REFERENCES agent_runs(id, user_id, app_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_one_active_input_request
ON agent_input_requests(run_id) WHERE status = 'requested';
CREATE INDEX IF NOT EXISTS agent_input_request_scope
ON agent_input_requests(user_id, app_id, run_id, status, requested_at);
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
    kind TEXT NOT NULL DEFAULT 'user' CHECK(kind IN ('user','recovery')),
    schema_version INTEGER NOT NULL CHECK(schema_version = 1),
    ledger_through INTEGER NOT NULL,
    event_through INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
    created_at INTEGER NOT NULL
);
`;

export const createAgentRecoveryCheckpointIndexSQL = `
CREATE UNIQUE INDEX IF NOT EXISTS agent_one_recovery_checkpoint_per_run
    ON agent_checkpoints(run_id) WHERE kind = 'recovery';
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
    kind TEXT NOT NULL DEFAULT 'tool' CHECK(kind IN ('tool','acp_permission')),
    inspection_json TEXT CHECK(inspection_json IS NULL OR json_valid(inspection_json)),
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
