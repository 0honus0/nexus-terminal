import type { MessageResponseDto } from './common.js';

export interface FavoritePathDto {
  id: number;
  name: string | null;
  path: string;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type FavoritePathSortDto = 'name' | 'lastUsedAt';

export interface FavoritePathMutationRequestDto {
  path: string;
  name: string | null;
}

export interface FavoritePathMutationResponseDto extends MessageResponseDto {
  favoritePath: FavoritePathDto | null;
}

export interface PathHistoryEntryDto {
  id: number;
  path: string;
  timestamp: number;
}

export interface PathHistoryAddRequestDto {
  path: string;
}

export interface PathHistoryAddResponseDto extends MessageResponseDto {
  id: number;
}

export interface PathHistoryClearResponseDto extends MessageResponseDto {
  count: number;
}
