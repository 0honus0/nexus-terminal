export interface ResultReadInput {
	toolCallId: string;
	sha256: string;
	offset: number;
	maxBytes: number;
}

export interface ResultPage {
	toolCallId: string;
	sha256: string;
	originalBytes: number;
	offset: number;
	nextOffset: number | null;
	text: string;
}

export interface ResultReadOutcome {
	page: ResultPage;
	targets: { id: number; version: number }[];
}

export interface ThreadEntryCursor {
	runSequence: number;
	messageOrdinal: number;
	chunkIndex: number;
	textOffset: number;
}

export interface ThreadEntries {
	appId: string;
	threadId: string;
	items: {
		runId: string;
		operationSequence: number;
		role: 'user' | 'assistant';
		position: ThreadEntryCursor;
		text: string;
	}[];
	nextCursor: ThreadEntryCursor;
}

export interface ThreadEntryHistory {
	body: ThreadEntries;
	startCursor: ThreadEntryCursor;
	hasEarlier: boolean;
}
