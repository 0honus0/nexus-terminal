import type { RunStepPolicyCheck } from '../../runs/storage/run-step-storage.js';
import type { StoredExecutionSettings, StoredExecutionUsage } from '../../execution/storage/execution-storage.js';

export interface StoredTitleScope {
	userId: number;
	appId: string;
	runId: string;
	creationHash: string;
}

export interface StoredTitleClaim {
	threadId: string;
	version: number;
}

export interface StoredTitleRecord {
	runId: string;
	threadId: string;
	threadVersion: number;
	creationHash: string;
	state: 'reserved' | 'dispatched' | 'completed' | 'failed' | 'unknown';
}

export interface StoredTitleCommand extends StoredTitleScope {
	claim: StoredTitleClaim;
	requestHash: string;
	estimatedTokens: number;
}

export type TitleBudgetAdmission = (settings: StoredExecutionSettings, usage: StoredExecutionUsage) => void;

export interface TitleStorage {
	claim(scope: StoredTitleScope, fallback: string, authorize: RunStepPolicyCheck): Promise<StoredTitleClaim | null>;
	reserve(command: StoredTitleCommand, authorize: RunStepPolicyCheck, admit: TitleBudgetAdmission): Promise<boolean>;
	dispatch(command: StoredTitleCommand, authorize: RunStepPolicyCheck, admit: TitleBudgetAdmission): Promise<boolean>;
	recordUsage(command: StoredTitleCommand, input: number, output: number): Promise<boolean>;
	finish(
		command: StoredTitleCommand,
		state: 'completed' | 'failed' | 'unknown',
		title: string | null,
		authorize: RunStepPolicyCheck,
	): Promise<boolean>;
}
