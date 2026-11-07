export interface OperationContentScope {
	userId: number;
	appId: string;
	runId: string;
}

export interface OperationContentReference {
	id: string;
	sha256: string;
	sizeBytes: number;
	mediaType: string;
}

/** Writes are fenced by the original execution and, for late results, its dispatched operation. */
export interface OperationContentWriteScope {
	userId: number;
	appId: string;
	runId: string;
	executionGeneration: string;
	operationId: string | null;
}

export interface OperationContentDraft {
	id: string;
	runId: string;
	ownerId: string;
	key: string;
	mediaType: string;
	chunks: number;
	sealed: boolean;
	sha256: string | null;
	sizeBytes: number;
}

export interface OperationContentChunk {
	index: number;
	text: string;
	sha256: string;
	sizeBytes: number;
}

export interface OperationContentPage {
	reference: OperationContentReference;
	index: number;
	text: string;
	nextIndex: number | null;
}
