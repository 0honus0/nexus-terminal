export interface StoredContentScope {
	userId: number;
	appId: string;
	runId: string;
}

/** Writes are fenced by the original execution and, for late results, its dispatched operation. */
export interface StoredContentWriteScope {
	userId: number;
	appId: string;
	runId: string;
	executionGeneration: string;
	operationId: string | null;
}

export interface StoredContentDraft {
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

export interface StoredContentChunk {
	index: number;
	text: string;
	sha256: string;
	sizeBytes: number;
}

export interface StoredContentReference {
	id: string;
	sha256: string;
	sizeBytes: number;
	mediaType: string;
}

export interface OperationContentStorage {
	exports(
		scope: StoredContentScope,
	): Promise<{ kind: 'complete' | 'suspend'; references: StoredContentReference[] } | null>;
	open(
		scope: StoredContentWriteScope,
		ownerId: string,
		key: string,
		mediaType: string,
		id: string,
	): Promise<StoredContentDraft>;
	get(scope: StoredContentScope, id: string): Promise<StoredContentDraft | null>;
	readable(scope: StoredContentScope, id: string, includeThread: boolean): Promise<StoredContentDraft | null>;
	append(
		scope: StoredContentWriteScope,
		ownerId: string,
		id: string,
		chunk: StoredContentChunk,
	): Promise<StoredContentDraft>;
	chunk(scope: StoredContentScope, id: string, index: number): Promise<StoredContentChunk | null>;
	seal(
		scope: StoredContentWriteScope,
		ownerId: string,
		id: string,
		chunks: number,
		sha256: string,
	): Promise<StoredContentDraft>;
}

export class OperationContentRefusal extends Error {
	constructor(readonly code: 'not_found' | 'idempotency_conflict' | 'version_conflict' | 'limit_exceeded') {
		super('Operation content: ' + code);
		this.name = 'OperationContentRefusal';
	}
}
