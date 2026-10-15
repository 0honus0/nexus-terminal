import type { HistoryKind } from '@nexus-terminal/shared/preferences/history/values';

export interface HistoryActor {
	userId: number;
	token: string;
}

export interface HistoryIdentity {
	userId: number | null;
}

export interface HistoryRecord {
	id: number;
	text: string;
	recordedAt: number;
}

export interface HistoryPage {
	entries: HistoryRecord[];
	nextOffset: number | null;
}

export interface HistoryQuery {
	kind: HistoryKind;
	offset: number;
	limit: number;
}

export interface HistoryAdd {
	kind: HistoryKind;
	text: string;
}

export interface HistoryInsert {
	kind: HistoryKind;
	text: string;
	recordedAt: number;
	retain: number;
}
