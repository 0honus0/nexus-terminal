import type { MessageResponseDto } from './common.js';

export interface CommandHistoryEntryDto {
  id: number;
  command: string;
  timestamp: number;
}

export interface CommandHistoryAddRequestDto {
  command: string;
}

export interface CommandHistoryAddResponseDto extends MessageResponseDto {
  id: number;
}

export interface CommandHistoryClearResponseDto extends MessageResponseDto {
  count: number;
}
