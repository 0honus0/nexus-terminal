import type { AgentJsonValueDto } from './agent-common.js';

export type AgentMemoryStatusDto = 'candidate' | 'published' | 'revoked';
export type AgentMemoryReviewActionDto = 'publish' | 'reject' | 'revoke';

export interface AgentMemoryViewDto {
  id: string;
  userId: number;
  appId: string;
  content: string;
  sourceRefs: AgentJsonValueDto;
  confidence: number;
  status: AgentMemoryStatusDto;
  expiresAt: number | null;
  proposedByRuntimeId: string | null;
  reviewAction: AgentMemoryReviewActionDto | null;
  reviewedAt: number | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentMemoryListQueryDto {
  status: AgentMemoryStatusDto | 'all';
  limit: number;
}

export interface AgentMemoryProposalRequestDto {
  content: string;
  sourceRefs: AgentJsonValueDto;
  confidence: number;
  expiresAt: number | null;
}

export interface AgentMemoryReviewRequestDto {
  decision: AgentMemoryReviewActionDto;
  expectedVersion: number;
  content?: string;
}

export interface AgentMemoryImportPreviewRequestDto {
  sourceAppId: string;
  sourceMemoryId: string;
}

export interface AgentMemoryImportConfirmationDto {
  id: string;
  userId: number;
  appId: string;
  sourceAppId: string;
  sourceMemoryId: string;
  sourceVersion: number;
  snapshot: AgentJsonValueDto;
  createdAt: number;
  expiresAt: number;
}

export type AgentMemoryImportConfirmRequestDto = Record<string, never>;
