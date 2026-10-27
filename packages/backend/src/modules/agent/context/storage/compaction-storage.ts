import type { StoredContextSnapshot, StoredContextToolResult } from './context-storage.js';
import type { RunStepPolicyCheck, StepScope } from '../../runs/storage/run-step-storage.js';
import type { StoredExecutionSettings, StoredExecutionUsage } from '../../execution/storage/execution-storage.js';

export interface StoredCompactionCommand extends StepScope {
	id: string;
	snapshot: StoredContextSnapshot;
	cut: number;
	estimatedTokens: number;
}

export interface StoredCompaction {
	id: string;
	rootId: string;
	runId: string;
	stepIndex: number;
	state: 'reserved' | 'dispatched' | 'completed' | 'failed' | 'unknown';
	source: StoredContextSnapshot;
	cut: number;
	summary: string | null;
	inputTokens: number | null;
	outputTokens: number | null;
}

export interface CompactionStorage {
	reserve(
		command: StoredCompactionCommand,
		authorize: RunStepPolicyCheck,
		verifyResults: (results: StoredContextToolResult[], previewBytes: number) => boolean,
		admit: (settings: StoredExecutionSettings, usage: StoredExecutionUsage) => void,
	): Promise<boolean>;
	dispatch(
		command: StoredCompactionCommand,
		authorize: RunStepPolicyCheck,
		admit: (settings: StoredExecutionSettings, usage: StoredExecutionUsage) => void,
	): Promise<boolean>;
	recordUsage(command: StoredCompactionCommand, input: number, output: number): Promise<boolean>;
	finish(
		command: StoredCompactionCommand,
		state: 'completed' | 'failed' | 'unknown',
		summary: string | null,
	): Promise<boolean>;
}
