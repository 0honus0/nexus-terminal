import { randomUUID } from 'node:crypto';
import type { JsonValue, Scope } from '../../../modules/agent/agent.types';
import type { ModelRef } from '../../../modules/agent/ai/model.types';
import type { RunBudget, RunUsage } from '../../../modules/agent/runtime/runs/run.types';
import type {
  CreateDelegationRecord,
  CreateDelegationResult,
  DelegationRepositoryPort,
  EnqueueWorkRecord,
  MailboxConsumerPort,
  MailboxReaderPort,
  MailboxRepositoryPort,
  RunScopeRepositoryPort,
  RuntimeModelWorkView,
  RuntimeParticipantRepositoryPort,
  RuntimeParticipantView,
  RuntimeToolExchangeView,
  RuntimeToolWorkView,
  SchedulerWorkClaimPort,
  SchedulerWorkExecutionPort,
  SendMessageRecord,
  SharedFactRepositoryPort,
  SharedFactView,
} from '../../../modules/agent/runtime/collaboration/subagent.repository.port';
import type {
  AgentMessage,
  DelegationView,
  MessageReceipt,
  SchedulerWorkView,
} from '../../../modules/agent/runtime/collaboration/subagent.types';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import { decodeModelCapabilitySnapshot, parseToolResult } from '../runtime/durable-state-decoders';
import { enqueueParentJoinResume } from '../runtime/subagent-join-wake';

interface RuntimeRow {
  id: string;
  run_id: string;
  participant_id: string;
  backend_kind: 'native' | 'acp';
  model_ref_json: string;
  status: RuntimeParticipantView['status'];
  schedule_state: RuntimeParticipantView['scheduleState'];
  consumed_mailbox_sequence: number;
}

interface DelegationRow {
  id: string;
  run_id: string;
  user_id: number;
  app_id: string;
  parent_runtime_id: string;
  child_runtime_id: string;
  profile_id: string;
  capabilities_json: string;
  peer_messaging: DelegationView['peerMessaging'];
  model_ref_json: string;
  objective: string;
  constraints_json: string;
  input_artifact_refs_json: string;
  completion_criteria_json: string;
  dependency_mode: DelegationView['dependencyMode'];
  status: DelegationView['status'];
  depth: number;
  failure_mode: DelegationView['failureMode'];
  max_steps: number;
  used_tokens: number;
  used_steps: number;
  result_json: string | null;
  evidence_refs_json: string;
  deadline_at: number;
  version: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  request_hash: string;
}

interface MessageRow {
  id: string;
  run_id: string;
  sender_runtime_id: string;
  recipient_runtime_id: string;
  delegation_id: string;
  recipient_sequence: number;
  kind: AgentMessage['kind'];
  correlation_id: string;
  reply_to: string | null;
  causation_id: string | null;
  task_revision: number;
  body_json: string;
  artifact_refs_json: string;
  status: AgentMessage['status'];
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
  payload_hash?: string;
}

interface WorkRow {
  enqueue_sequence: number;
  id: string;
  run_id: string;
  agent_runtime_id: string;
  kind: SchedulerWorkView['kind'];
  status: SchedulerWorkView['status'];
  payload_json: string;
  owner_epoch: number | null;
  not_before: number;
  deadline_at: number;
  created_at: number;
  updated_at: number;
  version: number;
}

interface RunStateRow {
  id: string;
  user_id: number;
  app_id: string;
  status: string;
  budget_json: string;
  usage_json: string;
  next_event_sequence: number;
  version: number;
}

const ACTIVE_RUN = new Set(['created', 'running', 'awaiting_approval', 'awaiting_budget', 'awaiting_input']);
const TERMINAL_DELEGATION = new Set<DelegationView['status']>(['completed', 'failed', 'cancelled']);

const MAX_DURABLE_COLLECTION_ITEMS = 16_384;
const MAX_DURABLE_STRING_BYTES = 2 * 1024 * 1024;
const MAX_DURABLE_JSON_DEPTH = 64;

type UnknownRecord = Record<string, unknown>;

const invalidDurableState = (): never => {
  throw new Error('SUBAGENT_DURABLE_STATE_INVALID');
};

const parsePersistedJson = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return invalidDurableState();
  }
};

const recordValue = (value: unknown): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidDurableState();
  return value as UnknownRecord;
};

const stringValue = (value: unknown): string => {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_DURABLE_STRING_BYTES)
    return invalidDurableState();
  return value;
};

const integerValue = (value: unknown, minimum = 0): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) return invalidDurableState();
  return Number(value);
};

const booleanValue = (value: unknown): boolean => {
  if (typeof value !== 'boolean') return invalidDurableState();
  return value;
};

const decodeJsonValue = (value: unknown, depth = 0): JsonValue => {
  if (depth > MAX_DURABLE_JSON_DEPTH) return invalidDurableState();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return stringValue(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return invalidDurableState();
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_DURABLE_COLLECTION_ITEMS) return invalidDurableState();
    return value.map((item) => decodeJsonValue(item, depth + 1));
  }
  const record = recordValue(value);
  const entries = Object.entries(record);
  if (entries.length > MAX_DURABLE_COLLECTION_ITEMS) return invalidDurableState();
  return Object.fromEntries(entries.map(([key, item]) => [key, decodeJsonValue(item, depth + 1)]));
};

const parseJsonValue = (value: string): JsonValue => decodeJsonValue(parsePersistedJson(value));

const decodeStringArray = (value: unknown, maxItems = 4096): string[] => {
  if (!Array.isArray(value) || value.length > maxItems) return invalidDurableState();
  return value.map(stringValue);
};

const parseStringArray = (value: string, maxItems = 4096): string[] =>
  decodeStringArray(parsePersistedJson(value), maxItems);

const decodeModelRef = (value: unknown): ModelRef => {
  const record = recordValue(value);
  return {
    providerId: stringValue(record.providerId),
    modelId: stringValue(record.modelId),
    configurationVersion: integerValue(record.configurationVersion, 1),
  };
};

const parseModelRef = (value: string): ModelRef => decodeModelRef(parsePersistedJson(value));

const parseDelegationModel = (
  value: string,
): { modelRef: ModelRef; modelCapabilities?: DelegationView['modelCapabilities'] } => {
  const record = recordValue(parsePersistedJson(value));
  return {
    modelRef: decodeModelRef(record),
    ...(record.modelCapabilities === undefined
      ? {}
      : { modelCapabilities: decodeModelCapabilitySnapshot(record.modelCapabilities) }),
  };
};

const decodeRunBudget = (value: string): RunBudget => {
  const record = recordValue(parsePersistedJson(value));
  const compactionMode = record.contextCompactionMode;
  if (
    compactionMode !== undefined &&
    !['aggressive', 'balanced', 'conservative'].includes(String(compactionMode))
  ) {
    return invalidDurableState();
  }
  return {
    maxContextTokens: integerValue(record.maxContextTokens, 1),
    maxOutputTokens: integerValue(record.maxOutputTokens, 1),
    maxRunSteps: integerValue(record.maxRunSteps, 1),
    maxActiveExecutionSeconds: integerValue(record.maxActiveExecutionSeconds, 1),
    toolTimeoutSeconds: integerValue(record.toolTimeoutSeconds, 1),
    maxToolOutputBytes: integerValue(record.maxToolOutputBytes, 1),
    maxRecallItems: integerValue(record.maxRecallItems, 1),
    maxRecallBytes: integerValue(record.maxRecallBytes, 1),
    maxSubagentMessages: integerValue(record.maxSubagentMessages, 1),
    maxSubagentMessageBytes: integerValue(record.maxSubagentMessageBytes, 1),
    ...(compactionMode === undefined
      ? {}
      : { contextCompactionMode: compactionMode as NonNullable<RunBudget['contextCompactionMode']> }),
    revision: integerValue(record.revision, 1),
  };
};

const decodeRunUsage = (value: string): RunUsage => {
  const record = recordValue(parsePersistedJson(value));
  const context = record.context === undefined ? null : recordValue(record.context);
  if (context && !['estimated', 'anchored_estimate', 'provider'].includes(String(context.source))) return invalidDurableState();
  return {
    inputTokens: integerValue(record.inputTokens),
    outputTokens: integerValue(record.outputTokens),
    cachedInputTokens: integerValue(record.cachedInputTokens),
    steps: integerValue(record.steps),
    subagentMessages: integerValue(record.subagentMessages),
    subagentMessageBytes: integerValue(record.subagentMessageBytes),
    ...(context === null
      ? {}
      : {
          context: {
            inputTokens: integerValue(context.inputTokens),
            ...(context.heuristicInputTokens === undefined
              ? {}
              : { heuristicInputTokens: integerValue(context.heuristicInputTokens, 1) }),
            reservedOutputTokens: integerValue(context.reservedOutputTokens),
            contextWindowTokens: integerValue(context.contextWindowTokens, 1),
            source: context.source as NonNullable<RunUsage['context']>['source'],
            ...(context.model === undefined ? {} : { model: decodeModelRef(context.model) }),
            ...(context.contextEpoch === undefined ? {} : { contextEpoch: stringValue(context.contextEpoch) }),
            updatedAt: integerValue(context.updatedAt),
          },
        }),
  };
};

const decodeToolInspection = (value: string): RuntimeToolWorkView['inspection'] => {
  const record = recordValue(parsePersistedJson(value));
  if (!['read', 'control', 'mutate', 'destructive', 'forbidden'].includes(String(record.risk)))
    return invalidDurableState();
  if (record.operationHashVersion !== 1) return invalidDurableState();
  const target = recordValue(record.target);
  if (!['machine', 'workspace', 'integration', 'browser', 'run'].includes(String(target.kind)))
    return invalidDurableState();
  if (!Array.isArray(record.preconditions) || record.preconditions.length > 256) return invalidDurableState();
  if (!Array.isArray(record.secretRefs) || record.secretRefs.length > 256) return invalidDurableState();
  return {
    toolName: stringValue(record.toolName),
    toolVersion: stringValue(record.toolVersion),
    normalizedArguments: decodeJsonValue(record.normalizedArguments),
    target: {
      kind: target.kind as RuntimeToolWorkView['inspection']['target']['kind'],
      targetIdentity: stringValue(target.targetIdentity),
      endpoint: stringValue(target.endpoint),
      loginUser: stringValue(target.loginUser),
      configurationHash: stringValue(target.configurationHash),
      ...(target.connectionId === undefined ? {} : { connectionId: integerValue(target.connectionId, 1) }),
      ...(target.workspaceId === undefined ? {} : { workspaceId: stringValue(target.workspaceId) }),
      ...(target.integrationId === undefined ? {} : { integrationId: stringValue(target.integrationId) }),
      ...(target.schemaHash === undefined ? {} : { schemaHash: stringValue(target.schemaHash) }),
      ...(target.browserSessionId === undefined ? {} : { browserSessionId: stringValue(target.browserSessionId) }),
      ...(target.snapshotId === undefined ? {} : { snapshotId: stringValue(target.snapshotId) }),
      ...(target.generation === undefined ? {} : { generation: integerValue(target.generation, 1) }),
      ...(target.hostKeyTrust === undefined
        ? {}
        : target.hostKeyTrust === 'unavailable'
          ? { hostKeyTrust: 'unavailable' as const }
          : invalidDurableState()),
    },
    resourceKeys: decodeStringArray(record.resourceKeys, 256),
    risk: record.risk as RuntimeToolWorkView['inspection']['risk'],
    mutation: booleanValue(record.mutation),
    operationHash: stringValue(record.operationHash),
    operationHashVersion: 1,
    preconditions: record.preconditions.map((item) => {
      const precondition = recordValue(item);
      if (!['fileHash', 'metadata', 'serviceState', 'workspaceGeneration'].includes(String(precondition.kind)))
        return invalidDurableState();
      return {
        kind: precondition.kind as RuntimeToolWorkView['inspection']['preconditions'][number]['kind'],
        key: stringValue(precondition.key),
        observedValue: decodeJsonValue(precondition.observedValue),
      };
    }),
    secretRefs: record.secretRefs.map((item) => {
      const secret = recordValue(item);
      return { id: stringValue(secret.id), version: integerValue(secret.version, 1) };
    }),
    policyRevision: integerValue(record.policyRevision, 1),
    inputRevision: integerValue(record.inputRevision),
  };
};
const delegationColumns = `d.id, d.run_id, r.user_id, r.app_id, d.parent_runtime_id, d.child_runtime_id,
  d.profile_id, d.capabilities_json, d.peer_messaging, d.model_ref_json, d.objective, d.constraints_json, d.input_artifact_refs_json,
  d.completion_criteria_json, d.dependency_mode, d.status, d.depth, d.failure_mode, d.max_steps,
  d.used_tokens, d.used_steps, d.result_json, d.evidence_refs_json,
  d.deadline_at, d.version, d.created_at, d.updated_at, d.completed_at, d.request_hash`;
const workColumns = `enqueue_sequence, id, run_id, agent_runtime_id, kind, status, payload_json, owner_epoch,
  not_before, deadline_at, created_at, updated_at, version`;
const qualifiedWorkColumns = `w.enqueue_sequence, w.id, w.run_id, w.agent_runtime_id, w.kind, w.status, w.payload_json, w.owner_epoch,
  w.not_before, w.deadline_at, w.created_at, w.updated_at, w.version`;

const mapRuntime = (row: RuntimeRow): RuntimeParticipantView => ({
  id: row.id,
  runId: row.run_id,
  participantId: row.participant_id,
  backendKind: row.backend_kind,
  modelRef: parseModelRef(row.model_ref_json),
  status: row.status,
  scheduleState: row.schedule_state,
  consumedMailboxSequence: row.consumed_mailbox_sequence,
});

const mapDelegation = (row: DelegationRow): DelegationView => {
  const model = parseDelegationModel(row.model_ref_json);
  return {
    id: row.id,
    runId: row.run_id,
    userId: row.user_id,
    appId: row.app_id,
    parentRuntimeId: row.parent_runtime_id,
    childRuntimeId: row.child_runtime_id,
    profileId: row.profile_id,
    capabilities: parseStringArray(row.capabilities_json, 512),
    peerMessaging: row.peer_messaging,
    modelRef: model.modelRef,
    ...(model.modelCapabilities === undefined ? {} : { modelCapabilities: model.modelCapabilities }),
    objective: row.objective,
    constraints: parseStringArray(row.constraints_json, 256),
    inputArtifactRefs: parseStringArray(row.input_artifact_refs_json, 1024),
    completionCriteria: parseStringArray(row.completion_criteria_json, 256),
    dependencyMode: row.dependency_mode,
    status: row.status,
    depth: row.depth,
    failureMode: row.failure_mode,
    budget: {
      maxSteps: row.max_steps,
    },
    usage: { tokens: row.used_tokens, steps: row.used_steps },
    result: row.result_json === null ? null : parseJsonValue(row.result_json),
    evidenceRefs: parseStringArray(row.evidence_refs_json, 1024),
    deadlineAt: row.deadline_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
};

const mapMessage = (row: MessageRow): AgentMessage => ({
  id: row.id,
  runId: row.run_id,
  senderRuntimeId: row.sender_runtime_id,
  recipientRuntimeId: row.recipient_runtime_id,
  delegationId: row.delegation_id,
  recipientSequence: row.recipient_sequence,
  kind: row.kind,
  correlationId: row.correlation_id,
  replyTo: row.reply_to,
  causationId: row.causation_id,
  taskRevision: row.task_revision,
  body: parseJsonValue(row.body_json),
  artifactRefs: parseStringArray(row.artifact_refs_json, 1024),
  status: row.status,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  consumedAt: row.consumed_at,
});

const mapWork = (row: WorkRow): SchedulerWorkView => ({
  id: row.id,
  enqueueSequence: row.enqueue_sequence,
  runId: row.run_id,
  agentRuntimeId: row.agent_runtime_id,
  kind: row.kind,
  status: row.status,
  payload: parseJsonValue(row.payload_json),
  ownerEpoch: row.owner_epoch,
  notBefore: row.not_before,
  deadlineAt: row.deadline_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  version: row.version,
});

const requireRun = async (tx: RelationalDatabase, scope: Scope, runId: string): Promise<RunStateRow> => {
  const row = await tx.queryOne<RunStateRow>(
    `SELECT id, user_id, app_id, status, budget_json, usage_json, next_event_sequence, version
     FROM agent_runs WHERE id = ? AND user_id = ? AND app_id = ?`,
    [runId, scope.userId, scope.appId],
  );
  if (!row) throw new Error('RUN_NOT_FOUND');
  return row;
};

const appendRunEvent = async (
  tx: RelationalDatabase,
  run: RunStateRow,
  type: string,
  payload: JsonValue,
  now: number,
  extraAssignments: string[] = [],
  extraParameters: unknown[] = [],
): Promise<void> => {
  await tx.execute(
    `INSERT INTO agent_events (event_id, run_id, sequence, schema_version, type, payload_json, occurred_at)
     VALUES (?, ?, ?, 1, ?, ?, ?)`,
    [randomUUID(), run.id, run.next_event_sequence, type, JSON.stringify(payload), now],
  );
  const updated = await tx.execute(
    `UPDATE agent_runs SET next_event_sequence = next_event_sequence + 1, version = version + 1, updated_at = ?
     ${extraAssignments.length ? `, ${extraAssignments.join(', ')}` : ''}
     WHERE id = ? AND version = ?`,
    [now, ...extraParameters, run.id, run.version],
  );
  if (updated.changes !== 1) throw new Error('STATE_CONFLICT');
};

const assertRuntimeInRun = async (tx: RelationalDatabase, runId: string, runtimeId: string): Promise<RuntimeRow> => {
  const row = await tx.queryOne<RuntimeRow>(
    `SELECT id, run_id, participant_id, backend_kind, model_ref_json, status, schedule_state, consumed_mailbox_sequence
     FROM agent_runtimes WHERE id = ? AND run_id = ?`,
    [runtimeId, runId],
  );
  if (!row) throw new Error('AGENT_RUNTIME_NOT_FOUND');
  return row;
};

const assertArtifactsInRun = async (
  tx: RelationalDatabase,
  scope: Scope,
  runId: string,
  artifactRefs: readonly string[],
  now: number,
): Promise<void> => {
  for (const artifactId of artifactRefs) {
    const allowed = await tx.queryOne<{ allowed: number }>(
      `SELECT 1 AS allowed
       FROM ai_artifacts a
       WHERE a.id = ? AND a.user_id = ? AND a.status = 'ready' AND (
         EXISTS (
           SELECT 1 FROM agent_artifact_links l
           WHERE l.artifact_id = a.id AND l.run_id = ?
         ) OR EXISTS (
           SELECT 1 FROM agent_artifact_grants g
           WHERE g.artifact_id = a.id AND g.receiver_user_id = ? AND g.receiver_app_id = ?
             AND g.receiver_run_id = ? AND g.revoked_at IS NULL
             AND (g.expires_at IS NULL OR g.expires_at > ?)
         )
       )
       LIMIT 1`,
      [artifactId, scope.userId, runId, scope.userId, scope.appId, runId, now],
    );
    if (!allowed) throw new Error('ARTIFACT_NOT_AUTHORIZED_FOR_RUN');
  }
};

const delegationInScope = async (
  tx: RelationalDatabase,
  scope: Scope,
  runId: string,
  delegationId: string,
): Promise<DelegationRow | null> =>
  tx.queryOne<DelegationRow>(
    `SELECT ${delegationColumns}
     FROM agent_delegations d JOIN agent_runs r ON r.id = d.run_id
     WHERE d.id = ? AND d.run_id = ? AND r.user_id = ? AND r.app_id = ?`,
    [delegationId, runId, scope.userId, scope.appId],
  );

export class SqliteSubagentRepository
  implements
    RunScopeRepositoryPort,
    RuntimeParticipantRepositoryPort,
    DelegationRepositoryPort,
    MailboxReaderPort,
    MailboxConsumerPort,
    MailboxRepositoryPort,
    SchedulerWorkClaimPort,
    SchedulerWorkExecutionPort,
    SharedFactRepositoryPort
{
  constructor(private readonly db: RelationalDatabase) {}

  async scopeForRun(runId: string): Promise<Scope | null> {
    const row = await this.db.queryOne<{ user_id: number; app_id: string }>(
      'SELECT user_id, app_id FROM agent_runs WHERE id = ?',
      [runId],
    );
    return row ? { userId: row.user_id, appId: row.app_id } : null;
  }

  async runtime(scope: Scope, runId: string, runtimeId: string): Promise<RuntimeParticipantView | null> {
    const row = await this.db.queryOne<RuntimeRow>(
      `SELECT rt.id, rt.run_id, rt.participant_id, rt.backend_kind, rt.model_ref_json, rt.status,
              rt.schedule_state, rt.consumed_mailbox_sequence
       FROM agent_runtimes rt JOIN agent_runs r ON r.id = rt.run_id
       WHERE rt.id = ? AND rt.run_id = ? AND r.user_id = ? AND r.app_id = ?`,
      [runtimeId, runId, scope.userId, scope.appId],
    );
    return row ? mapRuntime(row) : null;
  }

  async delegation(scope: Scope, runId: string, delegationId: string): Promise<DelegationView | null> {
    const row = await delegationInScope(this.db, scope, runId, delegationId);
    return row ? mapDelegation(row) : null;
  }

  async listDelegations(
    scope: Scope,
    runId: string,
    parentRuntimeId?: string,
    limit?: number,
    before?: { createdAt: number; id: string },
  ): Promise<DelegationView[]> {
    const boundedLimit = limit === undefined ? null : Math.max(1, Math.min(101, limit));
    const filters: string[] = [];
    const parameters: unknown[] = [runId, scope.userId, scope.appId];
    if (parentRuntimeId) {
      filters.push('d.parent_runtime_id = ?');
      parameters.push(parentRuntimeId);
    }
    if (before) {
      filters.push('(d.created_at < ? OR (d.created_at = ? AND d.id < ?))');
      parameters.push(before.createdAt, before.createdAt, before.id);
    }
    if (boundedLimit !== null) parameters.push(boundedLimit);
    const rows = await this.db.queryAll<DelegationRow>(
      `SELECT ${delegationColumns}
       FROM agent_delegations d JOIN agent_runs r ON r.id = d.run_id
       WHERE d.run_id = ? AND r.user_id = ? AND r.app_id = ?${filters.length ? ` AND ${filters.join(' AND ')}` : ''}
       ORDER BY d.created_at DESC, d.id DESC${boundedLimit === null ? '' : ' LIMIT ?'}`,
      parameters,
    );
    return rows.map(mapDelegation);
  }

  async createDelegation(record: CreateDelegationRecord): Promise<CreateDelegationResult> {
    return this.db.transaction(async (tx) => {
      const existing = await tx.queryOne<DelegationRow>(
        `SELECT ${delegationColumns}
         FROM agent_delegations d JOIN agent_runs r ON r.id = d.run_id
         WHERE d.run_id = ? AND d.parent_runtime_id = ? AND d.idempotency_key = ?
           AND r.user_id = ? AND r.app_id = ?`,
        [record.runId, record.parentRuntimeId, record.idempotencyKey, record.scope.userId, record.scope.appId],
      );
      if (existing) {
        if (existing.request_hash !== record.requestHash) throw new Error('IDEMPOTENCY_KEY_CONFLICT');
        return { delegation: mapDelegation(existing), replayed: true };
      }

      const run = await requireRun(tx, record.scope, record.runId);
      if (!ACTIVE_RUN.has(run.status)) throw new Error('RUN_NOT_ACTIVE');
      await assertRuntimeInRun(tx, record.runId, record.parentRuntimeId);
      await assertArtifactsInRun(tx, record.scope, record.runId, record.inputArtifactRefs, record.now);
      if (record.dependsOn.includes(record.id)) throw new Error('DELEGATION_WAIT_CYCLE');
      for (const dependencyId of record.dependsOn) {
        const dependency = await tx.queryOne<{ run_id: string }>('SELECT run_id FROM agent_delegations WHERE id = ?', [
          dependencyId,
        ]);
        if (!dependency) throw new Error('DEPENDENCY_NOT_FOUND');
        if (dependency.run_id !== record.runId) throw new Error('RESOURCE_FORBIDDEN');
      }

      const budget = decodeRunBudget(run.budget_json);
      const usage = decodeRunUsage(run.usage_json);
      // Delegation creation itself consumes one Run step. Future Child steps are not pre-reserved;
      // each beginSubagentModelStep atomically checks the parent Run emergency step fuse.
      if (usage.steps >= budget.maxRunSteps) throw new Error('RUN_BUDGET_EXCEEDED');
      const effectiveSteps = record.maxSteps;

      const scheduleState = record.dependsOn.length === 0 ? 'runnable' : 'queued';
      await tx.execute(
        `INSERT INTO agent_runtimes
          (id, run_id, participant_id, backend_kind, model_ref_json, status, execution_owner_id,
           created_at, updated_at, schedule_state, consumed_mailbox_sequence)
         VALUES (?, ?, ?, 'native', ?, 'created', ?, ?, ?, ?, 0)`,
        [
          record.childRuntimeId,
          record.runId,
          record.participantId,
          JSON.stringify({ ...record.modelRef, modelCapabilities: record.modelCapabilities }),
          record.childRuntimeId,
          record.now,
          record.now,
          scheduleState,
        ],
      );

      const step = await tx.queryOne<{ next_step: number }>(
        'SELECT COALESCE(MAX(step_index), 0) + 1 AS next_step FROM agent_steps WHERE run_id = ?',
        [record.runId],
      );
      const stepId = randomUUID();
      await tx.execute(
        `INSERT INTO agent_steps
          (id, run_id, agent_runtime_id, step_index, kind, status, input_watermark, input_refs_json,
           output_refs_json, created_at, completed_at)
         VALUES (?, ?, ?, ?, 'delegation', 'completed', 0, ?, ?, ?, ?)`,
        [
          stepId,
          record.runId,
          record.parentRuntimeId,
          step?.next_step ?? 1,
          JSON.stringify(record.inputArtifactRefs),
          JSON.stringify([{ delegationId: record.id, childRuntimeId: record.childRuntimeId }]),
          record.now,
          record.now,
        ],
      );

      await tx.execute(
        `INSERT INTO agent_delegations
          (id, run_id, parent_runtime_id, child_runtime_id, profile_id, capabilities_json, peer_messaging,
           model_ref_json, objective, constraints_json, input_artifact_refs_json, completion_criteria_json,
           dependency_mode, status, depth, failure_mode, max_steps,
           used_tokens, used_steps, result_json, evidence_refs_json, idempotency_key, request_hash, deadline_at,
           version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, 0, 0, NULL, '[]', ?, ?, ?, 1, ?, ?)`,
        [
          record.id,
          record.runId,
          record.parentRuntimeId,
          record.childRuntimeId,
          record.profileId,
          JSON.stringify(record.capabilities),
          record.peerMessaging,
          JSON.stringify({ ...record.modelRef, modelCapabilities: record.modelCapabilities }),
          record.objective,
          JSON.stringify(record.constraints),
          JSON.stringify(record.inputArtifactRefs),
          JSON.stringify(record.completionCriteria),
          record.dependencyMode,
          record.depth,
          record.failureMode,
          effectiveSteps,
          record.idempotencyKey,
          record.requestHash,
          record.deadlineAt,
          record.now,
          record.now,
        ],
      );
      for (const dependencyId of record.dependsOn) {
        await tx.execute(
          `INSERT INTO agent_delegation_edges (run_id, delegation_id, depends_on_id, mode) VALUES (?, ?, ?, ?)`,
          [record.runId, record.id, dependencyId, record.dependencyMode],
        );
      }
      await tx.execute(
        `INSERT INTO agent_scheduler_work
          (id, run_id, agent_runtime_id, kind, status, payload_json, owner_epoch, not_before,
           deadline_at, created_at, updated_at, version)
         VALUES (?, ?, ?, 'model_step', 'queued', ?, NULL, ?, ?, ?, ?, 1)`,
        [
          `work-${randomUUID()}`,
          record.runId,
          record.childRuntimeId,
          JSON.stringify({ delegationId: record.id, objective: record.objective }),
          record.now,
          record.deadlineAt,
          record.now,
          record.now,
        ],
      );

      const nextUsage: RunUsage = { ...usage, steps: usage.steps + 1 };
      await appendRunEvent(
        tx,
        run,
        'subagent.created',
        {
          delegationId: record.id,
          parentRuntimeId: record.parentRuntimeId,
          childRuntimeId: record.childRuntimeId,
          profileId: record.profileId,
          depth: record.depth,
          modelRef: decodeJsonValue(record.modelRef),
        },
        record.now,
        ['usage_json = ?'],
        [JSON.stringify(nextUsage)],
      );
      const created = await delegationInScope(tx, record.scope, record.runId, record.id);
      if (!created) throw new Error('DELEGATION_NOT_FOUND');
      return { delegation: mapDelegation(created), replayed: false };
    });
  }

  async cancelDelegation(
    scope: Scope,
    runId: string,
    delegationId: string,
    expectedVersion: number,
    now: number,
  ): Promise<DelegationView> {
    return this.db.transaction(async (tx) => {
      const run = await requireRun(tx, scope, runId);
      const current = await delegationInScope(tx, scope, runId, delegationId);
      if (!current) throw new Error('DELEGATION_NOT_FOUND');
      if (TERMINAL_DELEGATION.has(current.status)) return mapDelegation(current);
      const updated = await tx.execute(
        `UPDATE agent_delegations
         SET status = 'cancelled', version = version + 1, updated_at = ?, completed_at = ?
         WHERE id = ? AND run_id = ? AND version = ? AND status NOT IN ('completed','failed','cancelled')`,
        [now, now, delegationId, runId, expectedVersion],
      );
      if (updated.changes !== 1) throw new Error('DELEGATION_VERSION_CONFLICT');
      await tx.execute(
        `UPDATE agent_runtimes SET status = 'stopped', schedule_state = 'finished', updated_at = ?
         WHERE id = ? AND run_id = ? AND status NOT IN ('stopped','failed','interrupted')`,
        [now, current.child_runtime_id, runId],
      );
      await tx.execute(
        `UPDATE agent_scheduler_work
         SET status = 'cancelled', owner_epoch = NULL, version = version + 1, updated_at = ?
         WHERE agent_runtime_id = ? AND run_id = ? AND status IN ('queued','claimed','waiting')`,
        [now, current.child_runtime_id, runId],
      );
      await enqueueParentJoinResume(tx, runId, current.parent_runtime_id, delegationId, now);
      await appendRunEvent(
        tx,
        run,
        'subagent.cancelled',
        { delegationId, childRuntimeId: current.child_runtime_id },
        now,
      );
      const result = await delegationInScope(tx, scope, runId, delegationId);
      if (!result) throw new Error('DELEGATION_NOT_FOUND');
      return mapDelegation(result);
    });
  }

  async descendants(scope: Scope, runId: string, runtimeId: string): Promise<DelegationView[]> {
    await requireRun(this.db, scope, runId);
    const rows = await this.db.queryAll<DelegationRow>(
      `WITH RECURSIVE descendants(id, child_runtime_id) AS (
         SELECT id, child_runtime_id FROM agent_delegations WHERE run_id = ? AND parent_runtime_id = ?
         UNION ALL
         SELECT d.id, d.child_runtime_id
         FROM agent_delegations d JOIN descendants x ON d.parent_runtime_id = x.child_runtime_id
         WHERE d.run_id = ?
       )
       SELECT ${delegationColumns}
       FROM descendants x JOIN agent_delegations d ON d.id = x.id JOIN agent_runs r ON r.id = d.run_id
       WHERE r.user_id = ? AND r.app_id = ?
       ORDER BY d.depth DESC, d.created_at DESC`,
      [runId, runtimeId, runId, scope.userId, scope.appId],
    );
    return rows.map(mapDelegation);
  }

  async sendMessage(record: SendMessageRecord): Promise<MessageReceipt> {
    return this.db.transaction(async (tx) => {
      const run = await requireRun(tx, record.scope, record.runId);
      if (!ACTIVE_RUN.has(run.status)) throw new Error('RUN_NOT_ACTIVE');
      await assertRuntimeInRun(tx, record.runId, record.senderRuntimeId);
      await assertRuntimeInRun(tx, record.runId, record.recipientRuntimeId);
      await assertArtifactsInRun(tx, record.scope, record.runId, record.artifactRefs, record.now);
      const delegation = await tx.queryOne<{ run_id: string }>('SELECT run_id FROM agent_delegations WHERE id = ?', [
        record.delegationId,
      ]);
      if (!delegation || delegation.run_id !== record.runId) throw new Error('RESOURCE_FORBIDDEN');
      for (const relatedId of [record.replyTo, record.causationId]) {
        if (!relatedId) continue;
        const related = await tx.queryOne<{ run_id: string }>('SELECT run_id FROM agent_messages WHERE id = ?', [
          relatedId,
        ]);
        if (!related || related.run_id !== record.runId) throw new Error('MESSAGE_STALE');
      }
      const existing = await tx.queryOne<MessageRow>(
        `SELECT *, payload_hash FROM agent_messages
         WHERE run_id = ? AND sender_runtime_id = ? AND recipient_runtime_id = ? AND idempotency_key = ?`,
        [record.runId, record.senderRuntimeId, record.recipientRuntimeId, record.idempotencyKey],
      );
      if (existing) {
        if (existing.payload_hash !== record.payloadHash) throw new Error('IDEMPOTENCY_KEY_CONFLICT');
        return { messageId: existing.id, recipientSequence: existing.recipient_sequence, replayed: true };
      }
      const controlCompletion = record.kind === 'completion';
      const pending = await tx.queryOne<{ count: number }>(
        `SELECT COUNT(*) AS count FROM agent_messages
         WHERE recipient_runtime_id = ? AND status IN ('accepted','delivered')`,
        [record.recipientRuntimeId],
      );
      if (!controlCompletion && (pending?.count ?? 0) >= record.maxPending) throw new Error('MAILBOX_FULL');
      const totals = await tx.queryOne<{ count: number; bytes: number }>(
        'SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes FROM agent_messages WHERE run_id = ?',
        [record.runId],
      );
      const budget = decodeRunBudget(run.budget_json);
      const usage = decodeRunUsage(run.usage_json);
      const currentMessages = Number.isSafeInteger(usage.subagentMessages)
        ? usage.subagentMessages
        : (totals?.count ?? 0);
      const currentBytes = Number.isSafeInteger(usage.subagentMessageBytes)
        ? usage.subagentMessageBytes
        : (totals?.bytes ?? 0);
      const softMessages = Number.isSafeInteger(budget.maxSubagentMessages)
        ? budget.maxSubagentMessages
        : record.maxHardRunMessages;
      const softBytes = Number.isSafeInteger(budget.maxSubagentMessageBytes)
        ? budget.maxSubagentMessageBytes
        : record.maxHardRunBytes;
      const projectedMessages = currentMessages + 1;
      const projectedBytes = currentBytes + record.sizeBytes;
      if (
        !controlCompletion &&
        (projectedMessages > record.maxHardRunMessages || projectedBytes > record.maxHardRunBytes)
      ) {
        throw new Error('MAILBOX_HARD_LIMIT_EXCEEDED');
      }
      if (!controlCompletion && (projectedMessages > softMessages || projectedBytes > softBytes)) {
        throw new Error('MAILBOX_BUDGET_EXCEEDED');
      }
      const nextUsage: RunUsage = {
        ...usage,
        subagentMessages: projectedMessages,
        subagentMessageBytes: projectedBytes,
      };

      await tx.execute(
        'INSERT OR IGNORE INTO agent_mailbox_cursors (recipient_runtime_id, next_sequence) VALUES (?, 1)',
        [record.recipientRuntimeId],
      );
      const cursor = await tx.queryOne<{ next_sequence: number }>(
        'SELECT next_sequence FROM agent_mailbox_cursors WHERE recipient_runtime_id = ?',
        [record.recipientRuntimeId],
      );
      if (!cursor) throw new Error('MAILBOX_CURSOR_UNAVAILABLE');
      const advanced = await tx.execute(
        `UPDATE agent_mailbox_cursors SET next_sequence = next_sequence + 1
         WHERE recipient_runtime_id = ? AND next_sequence = ?`,
        [record.recipientRuntimeId, cursor.next_sequence],
      );
      if (advanced.changes !== 1) throw new Error('STATE_CONFLICT');
      await tx.execute(
        `INSERT INTO agent_messages
          (id, run_id, sender_runtime_id, recipient_runtime_id, delegation_id, recipient_sequence, kind,
           idempotency_key, payload_hash, correlation_id, reply_to, causation_id, task_revision, body_json,
           artifact_refs_json, size_bytes, status, created_at, expires_at, consumed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, NULL)`,
        [
          record.id,
          record.runId,
          record.senderRuntimeId,
          record.recipientRuntimeId,
          record.delegationId,
          cursor.next_sequence,
          record.kind,
          record.idempotencyKey,
          record.payloadHash,
          record.correlationId,
          record.replyTo,
          record.causationId,
          record.taskRevision,
          JSON.stringify(record.body),
          JSON.stringify(record.artifactRefs),
          record.sizeBytes,
          record.now,
          record.expiresAt,
        ],
      );
      const existingWork = await tx.queryOne<{ id: string }>(
        `SELECT id FROM agent_scheduler_work
         WHERE run_id = ? AND agent_runtime_id = ? AND kind = 'consume_inbox'
           AND status IN ('queued','claimed','waiting') LIMIT 1`,
        [record.runId, record.recipientRuntimeId],
      );
      if (!existingWork) {
        await tx.execute(
          `INSERT INTO agent_scheduler_work
            (id, run_id, agent_runtime_id, kind, status, payload_json, owner_epoch, not_before,
             deadline_at, created_at, updated_at, version)
           VALUES (?, ?, ?, 'consume_inbox', 'queued', ?, NULL, ?, ?, ?, ?, 1)`,
          [
            `work-${randomUUID()}`,
            record.runId,
            record.recipientRuntimeId,
            JSON.stringify({ cause: 'mailbox', through: cursor.next_sequence }),
            record.now,
            record.expiresAt,
            record.now,
            record.now,
          ],
        );
      } else {
        await tx.execute(
          `UPDATE agent_scheduler_work SET status = 'queued', not_before = MIN(not_before, ?),
           deadline_at = MAX(deadline_at, ?), version = version + 1, updated_at = ?
           WHERE id = ? AND status = 'waiting'`,
          [record.now, record.expiresAt, record.now, existingWork.id],
        );
      }
      await tx.execute(
        `UPDATE agent_runtimes SET schedule_state = CASE
           WHEN schedule_state IN ('waiting_message','joining','queued') THEN 'runnable' ELSE schedule_state END,
           updated_at = ? WHERE id = ? AND run_id = ?`,
        [record.now, record.recipientRuntimeId, record.runId],
      );
      await appendRunEvent(
        tx,
        run,
        'subagent.message_accepted',
        {
          messageId: record.id,
          senderRuntimeId: record.senderRuntimeId,
          recipientRuntimeId: record.recipientRuntimeId,
          recipientSequence: cursor.next_sequence,
          kind: record.kind,
        },
        record.now,
        ['usage_json = ?'],
        [JSON.stringify(nextUsage)],
      );
      return { messageId: record.id, recipientSequence: cursor.next_sequence, replayed: false };
    });
  }

  async readMessages(
    scope: Scope,
    runId: string,
    runtimeId: string,
    after: number,
    limit: number,
  ): Promise<AgentMessage[]> {
    return this.db.transaction(async (tx) => {
      await requireRun(tx, scope, runId);
      await assertRuntimeInRun(tx, runId, runtimeId);
      const rows = await tx.queryAll<MessageRow>(
        `SELECT id, run_id, sender_runtime_id, recipient_runtime_id, delegation_id, recipient_sequence, kind,
                correlation_id, reply_to, causation_id, task_revision, body_json, artifact_refs_json, status,
                created_at, expires_at, consumed_at
         FROM agent_messages WHERE run_id = ? AND recipient_runtime_id = ? AND recipient_sequence > ?
         ORDER BY recipient_sequence LIMIT ?`,
        [runId, runtimeId, after, limit],
      );
      const accepted = rows.filter((row) => row.status === 'accepted');
      if (accepted.length > 0) {
        const placeholders = accepted.map(() => '?').join(',');
        await tx.execute(
          `UPDATE agent_messages SET status = 'delivered'
           WHERE id IN (${placeholders}) AND status = 'accepted'`,
          accepted.map((row) => row.id),
        );
        for (const row of rows) {
          if (row.status === 'accepted') row.status = 'delivered';
        }
      }
      return rows.map(mapMessage);
    });
  }

  async listDelegationMessages(
    scope: Scope,
    runId: string,
    delegationId: string,
    limit: number,
    before?: { createdAt: number; id: string },
  ): Promise<AgentMessage[]> {
    await requireRun(this.db, scope, runId);
    const delegation = await delegationInScope(this.db, scope, runId, delegationId);
    if (!delegation) throw new Error('DELEGATION_NOT_FOUND');
    const rows = await this.db.queryAll<MessageRow>(
      `SELECT id, run_id, sender_runtime_id, recipient_runtime_id, delegation_id, recipient_sequence, kind,
              correlation_id, reply_to, causation_id, task_revision, body_json, artifact_refs_json, status,
              created_at, expires_at, consumed_at
       FROM agent_messages
       WHERE run_id = ? AND delegation_id = ?
         ${before ? 'AND (created_at < ? OR (created_at = ? AND id < ?))' : ''}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      before
        ? [runId, delegationId, before.createdAt, before.createdAt, before.id, limit]
        : [runId, delegationId, limit],
    );
    return rows.map(mapMessage);
  }

  async recentRuntimeToolExchanges(
    scope: Scope,
    runId: string,
    runtimeId: string,
    limit: number,
  ): Promise<RuntimeToolExchangeView[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) throw new Error('VALIDATION_FAILED');
    await requireRun(this.db, scope, runId);
    await assertRuntimeInRun(this.db, runId, runtimeId);
    const rows = await this.db.queryAll<{
      source_model_step_id: string;
      batch_index: number;
      batch_size: number;
      provider_call_id: string;
      tool_name: string;
      inspection_json: string;
      result_json: string | null;
      status: string;
    }>(
      `WITH recent_batches AS (
         SELECT source_model_step_id AS batch_key,
                MAX(created_at) AS batch_created_at
         FROM agent_tool_calls
         WHERE run_id = ? AND agent_runtime_id = ? AND status IN ('succeeded','failed')
         GROUP BY source_model_step_id
         ORDER BY batch_created_at DESC, batch_key DESC
         LIMIT ?
       )
       SELECT t.source_model_step_id,
              t.batch_index, t.batch_size, t.provider_call_id, t.tool_name,
              t.inspection_json, t.result_json, t.status
       FROM agent_tool_calls t
       JOIN recent_batches b
         ON b.batch_key = t.source_model_step_id
       WHERE t.run_id = ? AND t.agent_runtime_id = ? AND t.status IN ('succeeded','failed')
       ORDER BY b.batch_created_at, b.batch_key, t.batch_index, t.created_at, t.id`,
      [runId, runtimeId, limit, runId, runtimeId],
    );
    return rows.map((row) => {
      const inspection = decodeToolInspection(row.inspection_json);
      return {
        sourceModelStepId: row.source_model_step_id,
        batchIndex: row.batch_index,
        batchSize: row.batch_size,
        providerCallId: row.provider_call_id,
        toolName: row.tool_name,
        arguments: inspection.normalizedArguments ?? null,
        result: row.result_json ? parseToolResult(row.result_json) : null,
        status: row.status,
      };
    });
  }

  async runtimeToolWork(
    scope: Scope,
    runId: string,
    runtimeId: string,
    toolStepId: string,
    toolCallId: string,
  ): Promise<RuntimeToolWorkView | null> {
    await requireRun(this.db, scope, runId);
    await assertRuntimeInRun(this.db, runId, runtimeId);
    const row = await this.db.queryOne<{
      step_id: string;
      id: string;
      provider_call_id: string;
      status: string;
      inspection_json: string;
    }>(
      `SELECT step_id, id, provider_call_id, status, inspection_json
       FROM agent_tool_calls
       WHERE id = ? AND run_id = ? AND agent_runtime_id = ? AND step_id = ?`,
      [toolCallId, runId, runtimeId, toolStepId],
    );
    if (!row) return null;
    return {
      toolStepId: row.step_id,
      toolCallId: row.id,
      providerCallId: row.provider_call_id,
      status: row.status,
      inspection: decodeToolInspection(row.inspection_json),
    };
  }

  async activeRuntimeModelWork(scope: Scope, runId: string, runtimeId: string): Promise<RuntimeModelWorkView | null> {
    await requireRun(this.db, scope, runId);
    await assertRuntimeInRun(this.db, runId, runtimeId);
    const row = await this.db.queryOne<{ step_id: string; attempt_id: string }>(
      `SELECT s.id AS step_id, a.id AS attempt_id
       FROM agent_steps s
       JOIN agent_model_attempts a ON a.step_id = s.id
       WHERE s.run_id = ? AND s.agent_runtime_id = ? AND s.kind = 'model'
         AND s.status = 'running' AND a.status = 'streaming'
       ORDER BY s.created_at DESC, a.attempt_index DESC LIMIT 1`,
      [runId, runtimeId],
    );
    return row ? { stepId: row.step_id, attemptId: row.attempt_id } : null;
  }

  async consumeMessages(
    scope: Scope,
    runId: string,
    runtimeId: string,
    through: number,
    expectedConsumedSequence: number,
    now: number,
  ): Promise<number> {
    return this.db.transaction(async (tx) => {
      await requireRun(tx, scope, runId);
      const runtime = await assertRuntimeInRun(tx, runId, runtimeId);
      if (runtime.consumed_mailbox_sequence !== expectedConsumedSequence) throw new Error('MESSAGE_STALE');
      if (through <= expectedConsumedSequence) return expectedConsumedSequence;
      const rows = await tx.queryAll<{ recipient_sequence: number; status: AgentMessage['status'] }>(
        `SELECT recipient_sequence, status FROM agent_messages
         WHERE run_id = ? AND recipient_runtime_id = ? AND recipient_sequence > ? AND recipient_sequence <= ?
         ORDER BY recipient_sequence`,
        [runId, runtimeId, expectedConsumedSequence, through],
      );
      const expectedCount = through - expectedConsumedSequence;
      if (
        rows.length !== expectedCount ||
        rows.some((row, index) => row.recipient_sequence !== expectedConsumedSequence + index + 1)
      ) {
        throw new Error('MESSAGE_STALE');
      }
      await tx.execute(
        `UPDATE agent_messages SET status = 'consumed', consumed_at = ?
         WHERE run_id = ? AND recipient_runtime_id = ? AND recipient_sequence > ? AND recipient_sequence <= ?
           AND status IN ('accepted','delivered')`,
        [now, runId, runtimeId, expectedConsumedSequence, through],
      );
      const updated = await tx.execute(
        `UPDATE agent_runtimes SET consumed_mailbox_sequence = ?, updated_at = ?
         WHERE id = ? AND run_id = ? AND consumed_mailbox_sequence = ?`,
        [through, now, runtimeId, runId, expectedConsumedSequence],
      );
      if (updated.changes !== 1) throw new Error('MESSAGE_STALE');
      return through;
    });
  }

  async expireMessages(now: number, limit: number): Promise<number> {
    const rows = await this.db.queryAll<{ id: string }>(
      `SELECT id FROM agent_messages WHERE status IN ('accepted','delivered') AND expires_at <= ?
       ORDER BY expires_at, id LIMIT ?`,
      [now, limit],
    );
    if (rows.length === 0) return 0;
    const placeholders = rows.map(() => '?').join(',');
    const result = await this.db.execute(
      `UPDATE agent_messages SET status = 'expired' WHERE id IN (${placeholders}) AND status IN ('accepted','delivered')`,
      rows.map((row) => row.id),
    );
    return result.changes;
  }

  async enqueueWork(record: EnqueueWorkRecord): Promise<SchedulerWorkView> {
    return this.db.transaction(async (tx) => {
      const run = await tx.queryOne<{ status: string }>('SELECT status FROM agent_runs WHERE id = ?', [record.runId]);
      if (!run || run.status !== 'running') throw new Error('RUN_NOT_SCHEDULABLE');
      await tx.execute(
        `INSERT OR IGNORE INTO agent_scheduler_work
          (id, run_id, agent_runtime_id, kind, status, payload_json, owner_epoch, not_before,
           deadline_at, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, 'queued', ?, NULL, ?, ?, ?, ?, 1)`,
        [
          record.id,
          record.runId,
          record.runtimeId,
          record.kind,
          JSON.stringify(record.payload),
          record.notBefore,
          record.deadlineAt,
          record.now,
          record.now,
        ],
      );
      const row = await tx.queryOne<WorkRow>(`SELECT ${workColumns} FROM agent_scheduler_work WHERE id = ?`, [
        record.id,
      ]);
      if (!row) throw new Error('SCHEDULER_WORK_NOT_FOUND');
      return mapWork(row);
    });
  }

  async completeJoinResume(
    workId: string,
    ownerEpoch: number,
    runId: string,
    runtimeId: string,
    parentDelegationId: string | null,
    ready: boolean,
    now: number,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const work = await tx.queryOne<{ status: string; owner_epoch: number | null; version: number }>(
        `SELECT status, owner_epoch, version FROM agent_scheduler_work
         WHERE id = ? AND run_id = ? AND agent_runtime_id = ? AND kind = 'join_resume'`,
        [workId, runId, runtimeId],
      );
      if (!work || work.status !== 'claimed' || work.owner_epoch !== ownerEpoch) throw new Error('SCHEDULER_WORK_STALE');
      const runtime = await tx.queryOne<{ status: string; schedule_state: string }>(
        `SELECT status, schedule_state FROM agent_runtimes WHERE id = ? AND run_id = ?`,
        [runtimeId, runId],
      );
      const workStatus = runtime?.status === 'running' ? 'completed' : 'cancelled';
      const settled = await tx.execute(
        `UPDATE agent_scheduler_work SET status = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND status = 'claimed' AND owner_epoch = ? AND version = ?`,
        [workStatus, now, workId, ownerEpoch, work.version],
      );
      if (settled.changes !== 1) throw new Error('SCHEDULER_WORK_STALE');
      if (!runtime || runtime.status !== 'running' || runtime.schedule_state !== 'joining' || !ready) return false;

      const resumed = await tx.execute(
        `UPDATE agent_runtimes SET schedule_state = 'runnable', updated_at = ?
         WHERE id = ? AND run_id = ? AND status = 'running' AND schedule_state = 'joining'`,
        [now, runtimeId, runId],
      );
      if (resumed.changes !== 1) return false;
      if (parentDelegationId !== null) {
        const parent = await tx.queryOne<{ status: string; child_runtime_id: string; deadline_at: number }>(
          `SELECT status, child_runtime_id, deadline_at FROM agent_delegations WHERE id = ? AND run_id = ?`,
          [parentDelegationId, runId],
        );
        if (!parent || parent.child_runtime_id !== runtimeId || ['completed', 'failed', 'cancelled'].includes(parent.status)) {
          return false;
        }
        await tx.execute(
          `INSERT OR IGNORE INTO agent_scheduler_work
            (id, run_id, agent_runtime_id, kind, status, payload_json, owner_epoch, not_before,
             deadline_at, created_at, updated_at, version)
           VALUES (?, ?, ?, 'model_step', 'queued', ?, NULL, ?, ?, ?, ?, 1)`,
          [
            `model-resume:${workId}`,
            runId,
            runtimeId,
            JSON.stringify({ delegationId: parentDelegationId, cause: 'join_resume' }),
            now,
            parent.deadline_at,
            now,
            now,
          ],
        );
      }
      return true;
    });
  }

  async readyWork(now: number, limit: number, excludedRunIds: readonly string[] = []): Promise<SchedulerWorkView[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) throw new Error('VALIDATION_FAILED');
    const exclusions = [...new Set(excludedRunIds)].slice(0, 128);
    const exclusionSql = exclusions.length > 0 ? ` AND w.run_id NOT IN (${exclusions.map(() => '?').join(',')})` : '';
    const rows = await this.db.queryAll<WorkRow>(
      `SELECT ${qualifiedWorkColumns}
       FROM agent_scheduler_work w
       JOIN agent_runs r ON r.id = w.run_id
       JOIN agent_runtimes rt ON rt.id = w.agent_runtime_id AND rt.run_id = w.run_id
       LEFT JOIN agent_delegations d ON d.child_runtime_id = w.agent_runtime_id AND d.run_id = w.run_id
       WHERE w.status = 'queued' AND w.not_before <= ? AND w.deadline_at > ?
         AND r.status = 'running'
         AND (
           (w.kind = 'join_resume' AND rt.schedule_state = 'joining') OR
           (w.kind <> 'join_resume' AND rt.schedule_state IN ('queued','runnable'))
         )
         ${exclusionSql}
         AND NOT EXISTS (
           SELECT 1 FROM agent_delegation_edges e
           JOIN agent_delegations dep ON dep.id = e.depends_on_id
           WHERE e.delegation_id = d.id AND (
             (e.mode = 'success' AND dep.status <> 'completed') OR
             (e.mode = 'settled' AND dep.status NOT IN ('completed','failed','cancelled'))
           )
         )
       ORDER BY CASE WHEN ? - w.created_at >= 10 THEN 0 ELSE 1 END, w.enqueue_sequence
       LIMIT ?`,
      [now, now, ...exclusions, now, limit],
    );
    return rows.map(mapWork);
  }

  async terminalWork(now: number, limit: number): Promise<SchedulerWorkView[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) throw new Error('VALIDATION_FAILED');
    const rows = await this.db.queryAll<WorkRow>(
      `SELECT ${qualifiedWorkColumns}
       FROM agent_scheduler_work w
       JOIN agent_runs r ON r.id = w.run_id
       JOIN agent_runtimes rt ON rt.id = w.agent_runtime_id AND rt.run_id = w.run_id
       LEFT JOIN agent_delegations d ON d.child_runtime_id = w.agent_runtime_id AND d.run_id = w.run_id
       WHERE w.status = 'queued' AND w.kind IN ('model_step','tool_step') AND w.not_before <= ?
         AND r.status IN ('running','cancelling') AND rt.schedule_state IN ('queued','runnable')
         AND (
           w.deadline_at <= ? OR EXISTS (
             SELECT 1 FROM agent_delegation_edges e
             JOIN agent_delegations dep ON dep.id = e.depends_on_id
             WHERE e.delegation_id = d.id AND e.mode = 'success' AND dep.status IN ('failed','cancelled')
           )
         )
       ORDER BY w.enqueue_sequence
       LIMIT ?`,
      [now, now, limit],
    );
    return rows.map(mapWork);
  }

  async claimWork(
    workId: string,
    expectedVersion: number,
    ownerEpoch: number,
    now: number,
  ): Promise<SchedulerWorkView | null> {
    return this.db.transaction(async (tx) => {
      const candidate = await tx.queryOne<WorkRow>(
        `SELECT ${qualifiedWorkColumns}
         FROM agent_scheduler_work w
         JOIN agent_runs r ON r.id = w.run_id
         WHERE w.id = ? AND w.status = 'queued' AND w.not_before <= ? AND w.version = ? AND r.status = 'running'`,
        [workId, now, expectedVersion],
      );
      if (!candidate) return null;
      const claimed = await tx.execute(
        `UPDATE agent_scheduler_work SET status = 'claimed', owner_epoch = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND status = 'queued' AND version = ?
           AND EXISTS (
             SELECT 1 FROM agent_runs r
             WHERE r.id = agent_scheduler_work.run_id AND r.status = 'running'
           )`,
        [ownerEpoch, now, workId, expectedVersion],
      );
      if (claimed.changes !== 1) return null;
      if (candidate.kind !== 'consume_inbox' && candidate.kind !== 'join_resume') {
        await tx.execute(
          `UPDATE agent_runtimes SET schedule_state = 'executing', status = CASE WHEN status = 'created' THEN 'running' ELSE status END,
           updated_at = ? WHERE id = ? AND run_id = ? AND schedule_state IN ('queued','runnable')`,
          [now, candidate.agent_runtime_id, candidate.run_id],
        );
      }
      const row = await tx.queryOne<WorkRow>(`SELECT ${workColumns} FROM agent_scheduler_work WHERE id = ?`, [workId]);
      return row ? mapWork(row) : null;
    });
  }

  async settleWork(
    workId: string,
    ownerEpoch: number,
    status: 'completed' | 'waiting' | 'cancelled',
    now: number,
  ): Promise<void> {
    const result = await this.db.execute(
      `UPDATE agent_scheduler_work SET status = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND status = 'claimed' AND owner_epoch = ?`,
      [status, now, workId, ownerEpoch],
    );
    if (result.changes === 1) return;
    const current = await this.db.queryOne<{ status: string }>('SELECT status FROM agent_scheduler_work WHERE id = ?', [workId]);
    if (current?.status === 'cancelled') return;
    if (current?.status === status) return;
    throw new Error('SCHEDULER_WORK_STALE');
  }

  async resetClaimedWork(ownerEpoch: number, now: number): Promise<number> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.queryAll<{ id: string; agent_runtime_id: string; run_id: string; kind: string }>(
        `SELECT id, agent_runtime_id, run_id, kind FROM agent_scheduler_work
         WHERE status = 'waiting' OR (status = 'claimed' AND (owner_epoch IS NULL OR owner_epoch <> ?))`,
        [ownerEpoch],
      );
      for (const row of rows) {
        await tx.execute(
          `UPDATE agent_scheduler_work SET status = 'queued', owner_epoch = NULL, version = version + 1, updated_at = ?
           WHERE id = ? AND status IN ('claimed','waiting')`,
          [now, row.id],
        );
        if (row.kind !== 'join_resume') {
          await tx.execute(
            `UPDATE agent_runtimes SET schedule_state = 'runnable',
             status = CASE WHEN status = 'interrupted' THEN 'running' ELSE status END,
             updated_at = ? WHERE id = ? AND run_id = ? AND status IN ('created','running','interrupted')`,
            [now, row.agent_runtime_id, row.run_id],
          );
        }
      }
      return rows.length;
    });
  }

  async recoverOrphanedClaimedWork(
    ownerEpoch: number,
    activeWorkIds: readonly string[],
    staleBefore: number,
    now: number,
  ): Promise<number> {
    const active = [...new Set(activeWorkIds.filter((id) => typeof id === 'string' && id.length > 0))];
    return this.db.transaction(async (tx) => {
      const parameters: unknown[] = [ownerEpoch, staleBefore];
      let activeClause = '';
      if (active.length > 0) {
        activeClause = ` AND w.id NOT IN (${active.map(() => '?').join(',')})`;
        parameters.push(...active);
      }
      const rows = await tx.queryAll<{
        id: string;
        agent_runtime_id: string;
        run_id: string;
        kind: string;
        delegation_status: string | null;
      }>(
        `SELECT w.id, w.agent_runtime_id, w.run_id, w.kind, d.status AS delegation_status
         FROM agent_scheduler_work w
         LEFT JOIN agent_delegations d
           ON d.run_id = w.run_id AND d.child_runtime_id = w.agent_runtime_id
         WHERE w.status = 'claimed' AND w.owner_epoch = ? AND w.updated_at <= ?${activeClause}
         ORDER BY w.updated_at, w.enqueue_sequence
         LIMIT 64`,
        parameters,
      );
      let recovered = 0;
      for (const row of rows) {
        const terminalDelegation =
          row.delegation_status === 'completed' || row.delegation_status === 'failed' || row.delegation_status === 'cancelled';
        const nextStatus = terminalDelegation ? 'cancelled' : 'queued';
        const changed = await tx.execute(
          `UPDATE agent_scheduler_work
           SET status = ?, owner_epoch = NULL, version = version + 1, updated_at = ?
           WHERE id = ? AND status = 'claimed' AND owner_epoch = ? AND updated_at <= ?`,
          [nextStatus, now, row.id, ownerEpoch, staleBefore],
        );
        if (changed.changes !== 1) continue;
        recovered += 1;
        if (!terminalDelegation && row.kind !== 'join_resume') {
          await tx.execute(
            `UPDATE agent_runtimes SET schedule_state = 'runnable',
               status = CASE WHEN status = 'interrupted' THEN 'running' ELSE status END,
               updated_at = ?
             WHERE id = ? AND run_id = ? AND status IN ('created','running','interrupted')`,
            [now, row.agent_runtime_id, row.run_id],
          );
        }
      }
      return recovered;
    });
  }

  async getFact(scope: Scope, runId: string, key: string): Promise<SharedFactView | null> {
    const row = await this.db.queryOne<{
      run_id: string;
      key: string;
      value_json: string;
      bytes: number;
      version: number;
      updated_by_runtime_id: string;
      updated_at: number;
    }>(
      `SELECT f.run_id, f.key, f.value_json, f.bytes, f.version, f.updated_by_runtime_id, f.updated_at
       FROM agent_shared_facts f JOIN agent_runs r ON r.id = f.run_id
       WHERE f.run_id = ? AND f.key = ? AND r.user_id = ? AND r.app_id = ?`,
      [runId, key, scope.userId, scope.appId],
    );
    return row
      ? {
          runId: row.run_id,
          key: row.key,
          value: parseJsonValue(row.value_json),
          bytes: row.bytes,
          version: row.version,
          updatedByRuntimeId: row.updated_by_runtime_id,
          updatedAt: row.updated_at,
        }
      : null;
  }

  async compareAndSetFact(
    scope: Scope,
    runId: string,
    runtimeId: string,
    key: string,
    value: JsonValue,
    expectedVersion: number | null,
    maxRunBytes: number,
    now: number,
  ): Promise<SharedFactView> {
    return this.db.transaction(async (tx) => {
      await requireRun(tx, scope, runId);
      await assertRuntimeInRun(tx, runId, runtimeId);
      const encoded = JSON.stringify(value);
      const bytes = Buffer.byteLength(encoded, 'utf8');
      const current = await tx.queryOne<{ bytes: number; version: number }>(
        'SELECT bytes, version FROM agent_shared_facts WHERE run_id = ? AND key = ?',
        [runId, key],
      );
      const total = await tx.queryOne<{ bytes: number }>(
        'SELECT COALESCE(SUM(bytes), 0) AS bytes FROM agent_shared_facts WHERE run_id = ?',
        [runId],
      );
      if ((total?.bytes ?? 0) - (current?.bytes ?? 0) + bytes > maxRunBytes) throw new Error('FACT_QUOTA_EXCEEDED');
      if (expectedVersion === null) {
        if (current) throw new Error('FACT_VERSION_CONFLICT');
        await tx.execute(
          `INSERT INTO agent_shared_facts (run_id, key, value_json, bytes, version, updated_by_runtime_id, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
          [runId, key, encoded, bytes, runtimeId, now],
        );
      } else {
        if (!current || current.version !== expectedVersion) throw new Error('FACT_VERSION_CONFLICT');
        const updated = await tx.execute(
          `UPDATE agent_shared_facts SET value_json = ?, bytes = ?, version = version + 1,
           updated_by_runtime_id = ?, updated_at = ? WHERE run_id = ? AND key = ? AND version = ?`,
          [encoded, bytes, runtimeId, now, runId, key, expectedVersion],
        );
        if (updated.changes !== 1) throw new Error('FACT_VERSION_CONFLICT');
      }
      const result = await tx.queryOne<{
        run_id: string;
        key: string;
        value_json: string;
        bytes: number;
        version: number;
        updated_by_runtime_id: string;
        updated_at: number;
      }>(
        `SELECT run_id, key, value_json, bytes, version, updated_by_runtime_id, updated_at
         FROM agent_shared_facts WHERE run_id = ? AND key = ?`,
        [runId, key],
      );
      if (!result) throw new Error('FACT_NOT_FOUND');
      return {
        runId: result.run_id,
        key: result.key,
        value: parseJsonValue(result.value_json),
        bytes: result.bytes,
        version: result.version,
        updatedByRuntimeId: result.updated_by_runtime_id,
        updatedAt: result.updated_at,
      };
    });
  }
}
