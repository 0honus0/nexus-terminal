import type { AgentJsonValueDto } from './agent-common.js';

export type AgentThreadTitleSourceDto = 'placeholder' | 'auto' | 'manual';

export interface AgentThreadViewDto {
  id: string;
  appId: string;
  title: string;
  titleSource: AgentThreadTitleSourceDto;
  version: number;
  createdAt: number;
  updatedAt: number;
  latestRunId: string | null;
}

export interface AgentThreadPageDto {
  items: AgentThreadViewDto[];
  nextCursor: string | null;
}

export interface AgentThreadListQueryDto {
  limit: number;
  before?: string;
}

export interface AgentThreadCreateRequestDto {
  title?: string | null;
}

export interface AgentThreadRenameRequestDto {
  title: string;
  expectedVersion: number;
}

export interface AgentThreadDeleteRequestDto {
  expectedVersion: number;
}

export interface AgentThreadDeleteResultDto {
  threadId: string;
  deleted: true;
}

export interface AgentThreadDeleteAllRequestDto {
  confirmation: 'delete_all_threads';
}

export interface AgentThreadDeleteAllResultDto {
  deletedCount: number;
}

export type AgentLedgerEntryKindDto = 'user_input' | 'assistant_message' | 'tool_result' | 'system_notice';

export interface AgentLedgerEntryDto {
  id: string;
  threadId: string;
  runId: string | null;
  sequence: number;
  kind: AgentLedgerEntryKindDto;
  payload: AgentJsonValueDto;
  createdAt: number;
}

export interface AgentLedgerPageDto {
  items: AgentLedgerEntryDto[];
  nextCursor: string | null;
}

export interface AgentLedgerQueryDto {
  limit: number;
  before?: string;
}
