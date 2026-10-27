export interface ContextCheckpoint {
	id: string;
	runId: string;
	stepIndex: number;
	sourceHash: string;
	sourceMessages: number;
	summary: string;
	createdAt: number;
}

export interface CheckpointScope {
	userId: number;
	appId: string;
	runId: string;
}

export interface CheckpointAdmission {
	sourceMessages: number;
	sourceBytes: number;
}
