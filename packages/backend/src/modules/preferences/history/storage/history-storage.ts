import type { HistoryKind } from '@nexus-terminal/shared/preferences/history/values';

export interface StoredHistory {
	id: number;
	text: string;
	recordedAt: number;
}

export interface HistoryAuthorization {
	sessionDigest: string;
	admit(userId: number | null): void;
}

export interface HistoryInsertCommand {
	userId: number;
	kind: HistoryKind;
	text: string;
	retain: number;
}

export interface HistoryStorage {
	list(userId: number, kind: HistoryKind, offset: number, limit: number): Promise<StoredHistory[]>;
	add(command: HistoryInsertCommand, authorization: HistoryAuthorization): Promise<StoredHistory>;
	delete(userId: number, kind: HistoryKind, id: number, authorization: HistoryAuthorization): Promise<boolean>;
	clear(userId: number, kind: HistoryKind, authorization: HistoryAuthorization): Promise<number>;
}
