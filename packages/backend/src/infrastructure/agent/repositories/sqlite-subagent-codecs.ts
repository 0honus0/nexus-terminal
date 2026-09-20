import type { JsonValue } from '../../../modules/agent/agent.types';
import type { ModelRef } from '../../../modules/agent/ai/model.types';
import type { RunBudget, RunUsage } from '../../../modules/agent/runtime/runs/run.types';
import type {
  RuntimeParticipantView,
  RuntimeToolWorkView,
} from '../../../modules/agent/runtime/collaboration/subagent.repository.port';
import type {
  AgentMessage,
  DelegationView,
  SchedulerWorkView,
} from '../../../modules/agent/runtime/collaboration/subagent.types';
import { decodeModelCapabilitySnapshot } from '../runtime/durable-state-decoders';

export interface RuntimeRow {
  id: string;
  run_id: string;
  participant_id: string;
  backend_kind: 'native' | 'acp';
  model_ref_json: string;
  status: RuntimeParticipantView['status'];
  schedule_state: RuntimeParticipantView['scheduleState'];
  consumed_mailbox_sequence: number;
}

export interface DelegationRow {
  id: string;
  run_id: string;
  user_id: number;
  app_id: string;
  parent_runtime_id: string;
  child_runtime_id: string;
  profile_id: string;
  capabilities_json: string;
  peer_messaging: DelegationView['peerMessaging'];
  mutation_mode: DelegationView['mutationMode'];
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

export interface MessageRow {
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

export interface WorkRow {
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

export interface RunStateRow {
  id: string;
  user_id: number;
  app_id: string;
  status: string;
  budget_json: string;
  usage_json: string;
  next_event_sequence: number;
  version: number;
}
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

const assertRecordKeys = (record: UnknownRecord, allowed: readonly string[]): void => {
  const keys = new Set(allowed);
  if (Object.keys(record).some((key) => !keys.has(key))) return invalidDurableState();
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

export const decodeJsonValue = (value: unknown, depth = 0): JsonValue => {
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

export const parseJsonValue = (value: string): JsonValue => decodeJsonValue(parsePersistedJson(value));

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
): { modelRef: ModelRef; modelCapabilities: DelegationView['modelCapabilities'] } => {
  const record = recordValue(parsePersistedJson(value));
  assertRecordKeys(record, ['providerId', 'modelId', 'configurationVersion', 'modelCapabilities']);
  return {
    modelRef: decodeModelRef(record),
    modelCapabilities: decodeModelCapabilitySnapshot(record.modelCapabilities),
  };
};

export const decodeRunBudget = (value: string): RunBudget => {
  const record = recordValue(parsePersistedJson(value));
  assertRecordKeys(record, [
    'maxContextTokens',
    'maxOutputTokens',
    'maxRunSteps',
    'maxActiveExecutionSeconds',
    'toolTimeoutSeconds',
    'maxToolOutputBytes',
    'maxRecallItems',
    'maxRecallBytes',
    'maxSubagentMessages',
    'maxSubagentMessageBytes',
    'contextCompactionMode',
    'revision',
  ]);
  const compactionMode = record.contextCompactionMode;
  if (!['aggressive', 'balanced', 'conservative'].includes(String(compactionMode))) return invalidDurableState();
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
    contextCompactionMode: compactionMode as RunBudget['contextCompactionMode'],
    revision: integerValue(record.revision, 1),
  };
};

export const decodeRunUsage = (value: string): RunUsage => {
  const record = recordValue(parsePersistedJson(value));
  const context = record.context === undefined ? null : recordValue(record.context);
  if (context && !['estimated', 'anchored_estimate', 'provider'].includes(String(context.source)))
    return invalidDurableState();
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

export const decodeToolInspection = (value: string): RuntimeToolWorkView['inspection'] => {
  const record = recordValue(parsePersistedJson(value));
  assertRecordKeys(record, [
    'toolName',
    'toolVersion',
    'normalizedArguments',
    'target',
    'resourceKeys',
    'risk',
    'mutation',
    'operationHash',
    'operationHashVersion',
    'preconditions',
    'policyRevision',
    'inputRevision',
  ]);
  if (!['read', 'control', 'mutate', 'destructive', 'forbidden'].includes(String(record.risk)))
    return invalidDurableState();
  if (record.operationHashVersion !== 1) return invalidDurableState();
  const target = recordValue(record.target);
  assertRecordKeys(target, [
    'kind',
    'targetIdentity',
    'endpoint',
    'loginUser',
    'configurationHash',
    'connectionId',
    'workspaceId',
    'integrationId',
    'schemaHash',
    'browserSessionId',
    'snapshotId',
    'generation',
    'hostKeyTrust',
  ]);
  if (!['machine', 'workspace', 'integration', 'browser', 'run'].includes(String(target.kind)))
    return invalidDurableState();
  if (!Array.isArray(record.preconditions) || record.preconditions.length > 256) return invalidDurableState();
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
      assertRecordKeys(precondition, ['kind', 'key', 'observedValue']);
      if (!['fileHash', 'metadata', 'serviceState', 'workspaceGeneration'].includes(String(precondition.kind)))
        return invalidDurableState();
      return {
        kind: precondition.kind as RuntimeToolWorkView['inspection']['preconditions'][number]['kind'],
        key: stringValue(precondition.key),
        observedValue: decodeJsonValue(precondition.observedValue),
      };
    }),
    policyRevision: integerValue(record.policyRevision, 1),
    inputRevision: integerValue(record.inputRevision),
  };
};
export const delegationColumns = `d.id, d.run_id, r.user_id, r.app_id, d.parent_runtime_id, d.child_runtime_id,
  d.profile_id, d.capabilities_json, d.peer_messaging, d.mutation_mode, d.model_ref_json, d.objective, d.constraints_json, d.input_artifact_refs_json,
  d.completion_criteria_json, d.dependency_mode, d.status, d.depth, d.failure_mode, d.max_steps,
  d.used_tokens, d.used_steps, d.result_json, d.evidence_refs_json,
  d.deadline_at, d.version, d.created_at, d.updated_at, d.completed_at, d.request_hash`;
export const workColumns = `enqueue_sequence, id, run_id, agent_runtime_id, kind, status, payload_json, owner_epoch,
  not_before, deadline_at, created_at, updated_at, version`;
export const qualifiedWorkColumns = `w.enqueue_sequence, w.id, w.run_id, w.agent_runtime_id, w.kind, w.status, w.payload_json, w.owner_epoch,
  w.not_before, w.deadline_at, w.created_at, w.updated_at, w.version`;

export const mapRuntime = (row: RuntimeRow): RuntimeParticipantView => ({
  id: row.id,
  runId: row.run_id,
  participantId: row.participant_id,
  backendKind: row.backend_kind,
  modelRef: parseModelRef(row.model_ref_json),
  status: row.status,
  scheduleState: row.schedule_state,
  consumedMailboxSequence: row.consumed_mailbox_sequence,
});

export const mapDelegation = (row: DelegationRow): DelegationView => {
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
    mutationMode: row.mutation_mode,
    modelRef: model.modelRef,
    modelCapabilities: model.modelCapabilities,
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

export const mapMessage = (row: MessageRow): AgentMessage => ({
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

export const mapWork = (row: WorkRow): SchedulerWorkView => ({
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
