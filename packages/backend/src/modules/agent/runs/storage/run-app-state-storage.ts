import type { StoredOperationScope } from '../../operations/storage/operation-storage.js';

export interface StoredAppStateReference {
	id: string;
	sha256: string;
	sizeBytes: number;
	mediaType: string;
}

export interface StoredAppCheckpoint {
	version: number;
	state: StoredAppStateReference;
	consumedOperationIds: string[];
	pendingIntents: { operationKey: string; requestSha256: string }[];
}

export interface StoredAppRunInfo {
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

export interface StoredAppMessageAppend {
	ownerId: string;
	key: string;
	operationId: string | null;
	index: number;
	text: string;
	sha256: string;
}

export class RunAppStateRefusal extends Error {
	constructor(readonly code: 'not_found' | 'version_conflict' | 'idempotency_conflict' | 'forbidden') {
		super(code);
		this.name = 'RunAppStateRefusal';
	}
}

export interface RunAppStateStorage {
	describe(scope: StoredOperationScope): Promise<StoredAppRunInfo | null>;
	read(scope: StoredOperationScope): Promise<StoredAppCheckpoint | null>;
	write(scope: StoredOperationScope, checkpoint: StoredAppCheckpoint, now: number): Promise<StoredAppCheckpoint>;
	history(
		scope: StoredOperationScope,
		before: number | null,
		maxBytes: number,
	): Promise<{
		items: { runId: string; sequence: number; checkpoint: StoredAppCheckpoint }[];
		nextBefore: number | null;
	}>;
	append(scope: StoredOperationScope, message: StoredAppMessageAppend, now: number): Promise<void>;
	setTitle(
		scope: StoredOperationScope,
		operationId: string,
		operationHash: string,
		expectedThreadVersion: number,
		title: string,
		now: number,
	): Promise<boolean>;
}
