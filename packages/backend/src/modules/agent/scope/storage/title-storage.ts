export interface StoredTitleRecord {
	runId: string;
	threadId: string;
	threadVersion: number;
	creationHash: string;
	state: 'reserved' | 'dispatched' | 'completed' | 'failed' | 'unknown';
}
