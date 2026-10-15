export interface StoredCheckpointAuthority {
	userId: number;
	appId: string;
	runId: string;
	operationId: string;
	operationHash: string;
	stepIndex: number;
}

export interface StoredCheckpoint {
	id: string;
	runId: string;
	stepIndex: number;
	sourceHash: string;
	sourceMessages: number;
	summary: string;
	createdAt: number;
}

export interface CheckpointStorage {
	create(
		input: StoredCheckpointAuthority,
		id: string,
		summary: string,
		now: number,
		admit: (sourceMessages: number, sourceBytes: number) => void,
	): Promise<StoredCheckpoint | null>;
	get(userId: number, appId: string, runId: string, stepIndex: number): Promise<StoredCheckpoint | null>;
}
