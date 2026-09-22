import type { AgentJsonValueDto, AgentToolRiskDto, AgentVersionedRequestDto } from './agent-common.js';

export interface AgentToolPreconditionDto {
  kind: 'fileHash' | 'metadata' | 'serviceState' | 'workspaceGeneration';
  key: string;
  observedValue: AgentJsonValueDto;
}

export interface AgentToolTargetBaseDto {
  targetIdentity: string;
  endpoint: string;
  loginUser: string;
  configurationHash: string;
  connectionId?: number;
  workspaceId?: string;
  integrationId?: string;
  schemaHash?: string;
  browserSessionId?: string;
  snapshotId?: string;
  generation?: number;
  hostKeyTrust?: 'unavailable';
}

export interface AgentCanonicalToolTargetDto extends AgentToolTargetBaseDto {
  kind: 'workspace' | 'ssh';
  target: 'workspace' | 'ssh';
  id: string;
}

export interface AgentNonTargetToolTargetDto extends AgentToolTargetBaseDto {
  kind: 'integration' | 'browser' | 'run';
}

export type AgentToolTargetDto = AgentCanonicalToolTargetDto | AgentNonTargetToolTargetDto;

export interface AgentToolInspectionDto {
  toolName: string;
  toolVersion: string;
  normalizedArguments: AgentJsonValueDto;
  target: AgentToolTargetDto;
  resourceKeys: string[];
  risk: AgentToolRiskDto;
  mutation: boolean;
  operationHash: string;
  operationHashVersion: 1;
  preconditions: AgentToolPreconditionDto[];
  policyRevision: number;
  inputRevision: number;
}

export type AgentApprovalKindDto = 'tool' | 'acp_permission';
export type AgentApprovalStatusDto = 'requested' | 'approved' | 'denied' | 'expired' | 'superseded';
export type AgentApprovalDecisionDto = 'approved' | 'denied';

export interface AgentApprovalViewDto {
  id: string;
  userId: number;
  appId: string;
  runId: string;
  toolCallId: string;
  requestedByRuntimeId: string;
  operationHash: string;
  operationHashVersion: 1;
  kind: AgentApprovalKindDto;
  status: AgentApprovalStatusDto;
  policyRevision: number;
  inputRevision: number;
  decidedByUserId: number | null;
  decidedAt: number | null;
  consumedAt: number | null;
  requestedAt: number;
  expiresAt: number;
  version: number;
  inspection: AgentToolInspectionDto;
}

export interface AgentApprovalResolveFieldsDto {
  decision: AgentApprovalDecisionDto;
  operationHash: string;
  expectedVersion: number;
  feedback?: string;
}

export type AgentApprovalResolveRequestDto = AgentVersionedRequestDto<AgentApprovalResolveFieldsDto>;
