import type { CommandHistoryEntry, PathHistoryEntry } from './model.js';
import type { HistoryErrorCode } from './values.js';

export interface CommandHistoryAddRequest {
	command: string;
}

export interface PathHistoryAddRequest {
	path: string;
}

export interface HistoryListQuery {
	offset: number;
	limit: number;
}

export interface CommandHistoryListResponse {
	entries: CommandHistoryEntry[];
	nextOffset: number | null;
}

export interface PathHistoryListResponse {
	entries: PathHistoryEntry[];
	nextOffset: number | null;
}

export interface HistoryAddResponse {
	id: number;
}

export interface HistoryDeleteResponse {
	deleted: true;
}

export interface HistoryClearResponse {
	count: number;
}

export interface HistoryErrorResponse {
	code: HistoryErrorCode;
}
