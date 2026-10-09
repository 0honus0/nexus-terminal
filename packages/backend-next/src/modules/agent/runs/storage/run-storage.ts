/** Storage contracts: no HTTP DTO or SQLite row escapes. */
export type StoredRunStatus = 'pending' | 'cancelled';

export interface StoredRun {
	id: string;
	userId: number;
	appId: string;
	threadId: string;
	status: StoredRunStatus;
	version: number;
	createdAt: number;
	updatedAt: number;
}

export interface CreateRunStorageCommand {
	id: string;
	userId: number;
	appId: string;
	threadId: string;
	inputText: string;
	operationKey: string;
	requestHash: string;
	createdAt: number;
}

export interface CancelRunStorageCommand {
	userId: number;
	appId: string;
	runId: string;
	expectedVersion: number;
	operationKey: string;
	requestHash: string;
	now: number;
}

export type StoredCreateResult =
	| { status: 'created'; run: StoredRun }
	| { status: 'replayed'; originalStatus: 'created'; run: StoredRun }
	| { status: 'scope_not_found' | 'active_run_conflict' | 'idempotency_conflict' };

export type StoredCancelResult =
	| { status: 'cancelled' | 'already_cancelled'; run: StoredRun }
	| { status: 'replayed'; originalStatus: 'cancelled' | 'already_cancelled'; run: StoredRun }
	| { status: 'not_found' | 'version_conflict' | 'idempotency_conflict' };

export interface StoredRunEvent {
	runId: string;
	sequence: number;
	type: 'run.created' | 'run.cancelled';
	runVersion: number;
	createdAt: number;
}

export interface RunEventPageRecord {
	items: StoredRunEvent[];
	nextCursor: number;
}

export interface RunStorage {
	create(
		command: CreateRunStorageCommand,
		mayCreate: (active: StoredRun | null) => boolean,
	): Promise<StoredCreateResult>;
	cancel(
		command: CancelRunStorageCommand,
		decide: (run: StoredRun) => 'cancel' | 'already_cancelled' | 'version_conflict',
	): Promise<StoredCancelResult>;
	get(userId: number, appId: string, runId: string): Promise<StoredRun | null>;
	listEvents(
		userId: number,
		appId: string,
		runId: string,
		after: number,
		limit: number,
	): Promise<RunEventPageRecord | null>;
}
