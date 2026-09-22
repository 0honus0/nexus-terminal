import type { AgentJsonValueDto } from './agent-common.js';
import type { AgentCapabilityDto, AgentCapabilityScopeDto } from './agent-host.js';
import type { AgentModelCapabilitySnapshotDto, AgentModelRefDto } from './agent-runs.js';

export type AgentSubagentStatusDto = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export type AgentSubagentDependencyModeDto = 'success' | 'settled';
export type AgentSubagentFailureModeDto = 'isolate' | 'failFast';
export type AgentSubagentPeerMessagingDto = 'parent-child' | 'same-run';
export type AgentSubagentMutationModeDto = 'read-only' | 'governed';

export interface AgentDelegatedCapabilityGrantDto {
  capability: AgentCapabilityDto;
  schemaVersion: 2;
  scope: AgentCapabilityScopeDto;
}

export interface AgentSubagentProfileDto {
  id: string;
  role: string;
  defaultModel: AgentModelRefDto | null;
  allowedModels: AgentModelRefDto[];
  capabilities: AgentCapabilityDto[];
  peerMessaging: AgentSubagentPeerMessagingDto;
  mutationMode: AgentSubagentMutationModeDto;
  maxSteps: number;
  failureMode: AgentSubagentFailureModeDto;
}

export interface AgentSubagentProfileTemplateDto {
  id: 'explore' | 'scout' | 'review' | 'general' | 'worker';
  role: string;
  delegationHint: string;
  capabilities: AgentCapabilityDto[];
  peerMessaging: AgentSubagentPeerMessagingDto;
  mutationMode: AgentSubagentMutationModeDto;
  maxSteps: number;
  failureMode: AgentSubagentFailureModeDto;
}

export interface AgentSubagentSettingsViewDto {
  policy: {
    maxDelegationDepth: number;
    maxMessagesPerRun: number;
    maxMessageBytesPerRun: number;
    profiles: AgentSubagentProfileDto[];
  };
  templates: AgentSubagentProfileTemplateDto[];
  version: number;
}

export interface AgentSubagentSettingsReplaceRequestDto {
  profiles: AgentSubagentProfileDto[];
  expectedVersion: number;
}

export interface AgentSubagentCreateRequestDto {
  parentRuntimeId: string;
  profileId: string;
  objective: string;
  constraints: string[];
  inputArtifactRefs: string[];
  maxSteps: number;
  deadlineAt: number;
  completionCriteria: string[];
  dependsOn: string[];
  dependencyMode: AgentSubagentDependencyModeDto;
}

export interface AgentSubagentViewDto {
  id: string;
  userId: number;
  appId: string;
  runId: string;
  parentRuntimeId: string;
  childRuntimeId: string;
  profileId: string;
  grants: AgentDelegatedCapabilityGrantDto[];
  peerMessaging: AgentSubagentPeerMessagingDto;
  mutationMode: AgentSubagentMutationModeDto;
  modelRef: AgentModelRefDto;
  modelCapabilities: AgentModelCapabilitySnapshotDto;
  objective: string;
  constraints: string[];
  inputArtifactRefs: string[];
  completionCriteria: string[];
  dependencyMode: AgentSubagentDependencyModeDto;
  status: AgentSubagentStatusDto;
  depth: number;
  failureMode: AgentSubagentFailureModeDto;
  budget: { maxSteps: number };
  usage: { tokens: number; steps: number };
  result: AgentJsonValueDto | null;
  evidenceRefs: string[];
  deadlineAt: number;
  version: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface AgentSubagentListQueryDto {
  limit: number;
  parentRuntimeId?: string;
  before?: string;
}

export interface AgentSubagentPageDto {
  items: AgentSubagentViewDto[];
  nextCursor: string | null;
}

export interface AgentSubagentCancelRequestDto {
  expectedVersion: number;
}

export type AgentSubagentMessageKindDto = 'request' | 'reply' | 'progress' | 'evidence' | 'completion';
export type AgentSubagentMessageStatusDto = 'accepted' | 'delivered' | 'consumed' | 'expired' | 'rejected';

export interface AgentSubagentMessageDto {
  id: string;
  runId: string;
  senderRuntimeId: string;
  recipientRuntimeId: string;
  delegationId: string;
  recipientSequence: number;
  kind: AgentSubagentMessageKindDto;
  correlationId: string;
  replyTo: string | null;
  causationId: string | null;
  taskRevision: number;
  body: AgentJsonValueDto;
  artifactRefs: string[];
  status: AgentSubagentMessageStatusDto;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

export interface AgentSubagentMessageListQueryDto {
  limit: number;
  before?: string;
}

export interface AgentSubagentMessagePageDto {
  items: AgentSubagentMessageDto[];
  nextCursor: string | null;
}
