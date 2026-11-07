export interface AppStateReference {
	id: string;
	sha256: string;
	sizeBytes: number;
	mediaType: string;
}

export interface AppCheckpoint {
	version: number;
	state: AppStateReference;
	consumedOperationIds: string[];
	pendingIntents: { operationKey: string; requestSha256: string }[];
}

export interface AppRunInfo {
	runId: string;
	threadId: string;
	threadVersion: number;
	autoTitle: boolean;
	inputJson: string;
	resumeInputJson: string | null;
	prompt: string;
	sequence: number;
	deadlineUnixMs: number;
}

export interface AppRunHistory {
	items: { runId: string; sequence: number; checkpoint: AppCheckpoint }[];
	nextBefore: number | null;
}

export interface AppMessageAppend {
	ownerId: string;
	key: string;
	operationId: string | null;
	index: number;
	text: string;
}
