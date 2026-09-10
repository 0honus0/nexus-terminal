import type { JsonValue, Scope } from '../../agent.types';
import type { ModelRef } from '../../ai/model.types';
import type { CommandIdentity } from '../runs/run.types';

export type SubagentStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export type ScheduleState =
  | 'queued'
  | 'runnable'
  | 'executing'
  | 'waiting_message'
  | 'waiting_approval'
  | 'waiting_budget'
  | 'joining'
  | 'finished';
export type DependencyMode = 'success' | 'settled';
export type SubagentFailureMode = 'isolate' | 'failFast';
export type PeerMessaging = 'parent-child' | 'same-run';

export interface SubagentProfile {
  id: string;
  role: string;
  defaultModel: ModelRef | null;
  allowedModels: ModelRef[];
  capabilities: string[];
  peerMessaging: PeerMessaging;
  maxTokens: number;
  maxSteps: number;
  failureMode: SubagentFailureMode;
}

export interface SubagentPolicy {
  maxDelegationDepth: number;
  maxMessagesPerRun: number;
  maxMessageBytesPerRun: number;
  profiles: SubagentProfile[];
}

export interface SubagentSettingsView {
  policy: SubagentPolicy;
  version: number;
}

export interface SubagentRequest {
  profileId: string;
  objective: string;
  constraints: string[];
  inputArtifactRefs: string[];
  maxTokens: number;
  maxSteps: number;
  deadlineAt: number;
  completionCriteria: string[];
  dependsOn: string[];
  dependencyMode: DependencyMode;
  command: CommandIdentity;
}

export interface DelegationView extends Scope {
  id: string;
  runId: string;
  parentRuntimeId: string;
  childRuntimeId: string;
  profileId: string;
  capabilities: string[];
  peerMessaging: PeerMessaging;
  modelRef: ModelRef;
  objective: string;
  constraints: string[];
  inputArtifactRefs: string[];
  completionCriteria: string[];
  dependencyMode: DependencyMode;
  status: SubagentStatus;
  depth: number;
  failureMode: SubagentFailureMode;
  budget: {
    maxTokens: number;
    maxSteps: number;
    reservedTokens: number;
    reservedSteps: number;
  };
  usage: { tokens: number; steps: number };
  result: JsonValue | null;
  evidenceRefs: string[];
  deadlineAt: number;
  version: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export type AgentMessageKind = 'request' | 'reply' | 'progress' | 'evidence' | 'completion';
export type AgentMessageStatus = 'accepted' | 'delivered' | 'consumed' | 'expired' | 'rejected';

export interface AgentMessage {
  id: string;
  runId: string;
  senderRuntimeId: string;
  recipientRuntimeId: string;
  delegationId: string;
  recipientSequence: number;
  kind: AgentMessageKind;
  correlationId: string;
  replyTo: string | null;
  causationId: string | null;
  taskRevision: number;
  body: JsonValue;
  artifactRefs: string[];
  status: AgentMessageStatus;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

export interface MessageReceipt {
  messageId: string;
  recipientSequence: number;
  replayed: boolean;
}

export type SchedulerWorkKind = 'model_step' | 'tool_step' | 'consume_inbox' | 'verify' | 'join_resume';
export type SchedulerWorkStatus = 'queued' | 'claimed' | 'waiting' | 'completed' | 'cancelled';

export interface SchedulerWorkView {
  id: string;
  enqueueSequence: number;
  runId: string;
  agentRuntimeId: string;
  kind: SchedulerWorkKind;
  status: SchedulerWorkStatus;
  payload: JsonValue;
  ownerEpoch: number | null;
  notBefore: number;
  deadlineAt: number;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface JoinResult {
  settled: DelegationView[];
  running: DelegationView[];
  timedOut: boolean;
}
