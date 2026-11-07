import type { StoredRun } from './run-storage.js';
import type { StoredExecutionSettings } from '../../execution/storage/execution-storage.js';

export interface StoredResumeRunCommand {
	userId: number;
	appId: string;
	runId: string;
	expectedVersion: number;
	operationKey: string;
	requestHash: string;
	inputJson: string;
}

export type StoredResumeRunResult =
	| {
			status: 'resumed';
			run: StoredRun;
			parentId: string | null;
			requestHash: string;
			deadlineAt: number;
			prompt: string;
			inputJson: string;
	  }
	| { status: 'replayed'; originalStatus: 'resumed'; run: StoredRun }
	| { status: 'not_found' | 'version_conflict' | 'idempotency_conflict' | 'active_run_conflict' };

export interface StoredRunSuspension {
	runId: string;
	runVersion: number;
	checkpointVersion: number;
	inputRequest: { id: string; sha256: string; sizeBytes: number; mediaType: string };
	suspendedAt: number;
}

export interface RunResumeStorage {
	resume(
		command: StoredResumeRunCommand,
		admit: (settings: StoredExecutionSettings | null, activeRuns: number) => void,
	): Promise<StoredResumeRunResult>;
	suspension(userId: number, appId: string, runId: string): Promise<StoredRunSuspension | null>;
}
