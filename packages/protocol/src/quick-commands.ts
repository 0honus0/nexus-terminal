import type { MessageResponseDto } from './common.js';

export interface QuickCommandTagDto {
  id: number;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface QuickCommandDto {
  id: number;
  name: string | null;
  command: string;
  usageCount: number;
  variables: Record<string, string>;
  tagIds: number[];
  createdAt: number;
  updatedAt: number;
}

export interface QuickCommandMutationRequestDto {
  name: string | null;
  command: string;
  variables: Record<string, string>;
  tagIds: number[];
}

export interface QuickCommandMutationResponseDto extends MessageResponseDto {
  command: QuickCommandDto | null;
  id?: number;
}

export interface QuickCommandIncrementResponseDto extends MessageResponseDto {
  command: QuickCommandDto | null;
}

export interface QuickCommandBulkAssignTagRequestDto {
  commandIds: number[];
  tagId: number;
}

export interface QuickCommandBulkAssignTagResponseDto {
  success: boolean;
  message: string;
}

export interface QuickCommandTagNameRequestDto {
  name: string;
}

export interface QuickCommandTagMutationResponseDto extends MessageResponseDto {
  tag: QuickCommandTagDto | null;
}
