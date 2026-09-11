import type { JsonValue, Scope } from '../../agent.types';
import type { ModelRef } from '../../ai/model.types';
import type { ToolInspection } from '../../capabilities/tool.types';
import type {
  AgentMessage,
  AgentMessageKind,
  DelegationView,
  DependencyMode,
  MessageReceipt,
  PeerMessaging,
  ScheduleState,
  SchedulerWorkKind,
  SchedulerWorkView,
  SubagentFailureMode,
} from './subagent.types';

export interface RuntimeParticipantView {
  id: string;
  runId: string;
  participantId: string;
  backendKind: 'native' | 'acp';
  modelRef: ModelRef;
  status: 'created' | 'running' | 'stopping' | 'stopped' | 'failed' | 'interrupted';
  scheduleState: ScheduleState;
  consumedMailboxSequence: number;
}

export interface CreateDelegationRecord {
  scope: Scope;
  id: string;
  runId: string;
  parentRuntimeId: string;
  childRuntimeId: string;
  participantId: string;
  profileId: string;
  capabilities: string[];
  peerMessaging: PeerMessaging;
  modelRef: ModelRef;
  objective: string;
  constraints: string[];
  inputArtifactRefs: string[];
  completionCriteria: string[];
  dependencyMode: DependencyMode;
  dependsOn: string[];
  depth: number;
  failureMode: SubagentFailureMode;
  maxTokens: number;
  maxSteps: number;
  reservedTokens: number;
  reservedSteps: number;
  idempotencyKey: string;
  requestHash: string;
  deadlineAt: number;
  now: number;
}

export interface CreateDelegationResult {
  delegation: DelegationView;
  replayed: boolean;
}

export interface EnqueueWorkRecord {
  id: string;
  runId: string;
  runtimeId: string;
  kind: SchedulerWorkKind;
  payload: JsonValue;
  notBefore: number;
  deadlineAt: number;
  now: number;
}

export interface SendMessageRecord {
  scope: Scope;
  id: string;
  runId: string;
  senderRuntimeId: string;
  recipientRuntimeId: string;
  delegationId: string;
  kind: AgentMessageKind;
  idempotencyKey: string;
  payloadHash: string;
  correlationId: string;
  replyTo: string | null;
  causationId: string | null;
  taskRevision: number;
  body: JsonValue;
  artifactRefs: string[];
  sizeBytes: number;
  expiresAt: number;
  now: number;
  maxPending: number;
  maxHardRunMessages: number;
  maxHardRunBytes: number;
}

export interface RuntimeToolExchangeView {
  providerCallId: string;
  toolName: string;
  arguments: JsonValue;
  result: JsonValue | null;
  status: string;
}

export interface RuntimeToolWorkView {
  toolStepId: string;
  toolCallId: string;
  providerCallId: string;
  status: string;
  inspection: ToolInspection;
}

export interface RuntimeModelWorkView {
  stepId: string;
  attemptId: string;
}

export interface SharedFactView {
  runId: string;
  key: string;
  value: JsonValue;
  bytes: number;
  version: number;
  updatedByRuntimeId: string;
  updatedAt: number;
}

export interface RunScopeRepositoryPort {
  scopeForRun(runId: string): Promise<Scope | null>;
}

export interface RuntimeParticipantRepositoryPort {
  runtime(scope: Scope, runId: string, runtimeId: string): Promise<RuntimeParticipantView | null>;
  recentRuntimeToolExchanges(
    scope: Scope,
    runId: string,
    runtimeId: string,
    limit: number,
  ): Promise<RuntimeToolExchangeView[]>;
  runtimeToolWork(
    scope: Scope,
    runId: string,
    runtimeId: string,
    toolStepId: string,
    toolCallId: string,
  ): Promise<RuntimeToolWorkView | null>;
  activeRuntimeModelWork(scope: Scope, runId: string, runtimeId: string): Promise<RuntimeModelWorkView | null>;
}

export interface DelegationRepositoryPort {
  delegation(scope: Scope, runId: string, delegationId: string): Promise<DelegationView | null>;
  listDelegations(
    scope: Scope,
    runId: string,
    parentRuntimeId?: string,
    limit?: number,
    before?: { createdAt: number; id: string },
  ): Promise<DelegationView[]>;
  createDelegation(record: CreateDelegationRecord): Promise<CreateDelegationResult>;
  cancelDelegation(
    scope: Scope,
    runId: string,
    delegationId: string,
    expectedVersion: number,
    now: number,
  ): Promise<DelegationView>;
  descendants(scope: Scope, runId: string, runtimeId: string): Promise<DelegationView[]>;
}

export interface MailboxRepositoryPort {
  sendMessage(record: SendMessageRecord): Promise<MessageReceipt>;
  readMessages(scope: Scope, runId: string, runtimeId: string, after: number, limit: number): Promise<AgentMessage[]>;
  listDelegationMessages(
    scope: Scope,
    runId: string,
    delegationId: string,
    limit: number,
    before?: { createdAt: number; id: string },
  ): Promise<AgentMessage[]>;
  consumeMessages(
    scope: Scope,
    runId: string,
    runtimeId: string,
    through: number,
    expectedConsumedSequence: number,
    now: number,
  ): Promise<number>;
  expireMessages(now: number, limit: number): Promise<number>;
}

export interface SchedulerWorkRepositoryPort {
  enqueueWork(record: EnqueueWorkRecord): Promise<SchedulerWorkView>;
  readyWork(now: number, limit: number, excludedRunIds?: readonly string[]): Promise<SchedulerWorkView[]>;
  terminalWork(now: number, limit: number): Promise<SchedulerWorkView[]>;
  claimWork(
    workId: string,
    expectedVersion: number,
    ownerEpoch: number,
    now: number,
  ): Promise<SchedulerWorkView | null>;
  claimNextWork(ownerEpoch: number, now: number): Promise<SchedulerWorkView | null>;
  settleWork(
    workId: string,
    ownerEpoch: number,
    status: 'completed' | 'waiting' | 'cancelled',
    now: number,
  ): Promise<void>;
  resetClaimedWork(ownerEpoch: number, now: number): Promise<number>;
}

export interface SharedFactRepositoryPort {
  getFact(scope: Scope, runId: string, key: string): Promise<SharedFactView | null>;
  compareAndSetFact(
    scope: Scope,
    runId: string,
    runtimeId: string,
    key: string,
    value: JsonValue,
    expectedVersion: number | null,
    maxRunBytes: number,
    now: number,
  ): Promise<SharedFactView>;
}
