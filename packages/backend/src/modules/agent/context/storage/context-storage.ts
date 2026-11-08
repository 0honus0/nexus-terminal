export interface ContextStorage {
	readPreviousEntries(
		userId: number,
		appId: string,
		threadId: string,
		before: StoredThreadEntryCursor | null,
		limit: number,
	): Promise<StoredThreadEntryHistory | null>;
	readEntries(
		userId: number,
		appId: string,
		threadId: string,
		after: StoredThreadEntryCursor,
		limit: number,
	): Promise<StoredThreadEntries | null>;
}

export interface StoredThreadEntryCursor {
	runSequence: number;
	messageOrdinal: number;
	chunkIndex: number;
	textOffset: number;
}

export interface StoredThreadEntries {
	appId: string;
	threadId: string;
	items: {
		runId: string;
		operationSequence: number;
		role: 'user' | 'assistant';
		position: StoredThreadEntryCursor;
		text: string;
	}[];
	nextCursor: StoredThreadEntryCursor;
}

export interface StoredThreadEntryHistory {
	body: StoredThreadEntries;
	startCursor: StoredThreadEntryCursor;
	hasEarlier: boolean;
}
