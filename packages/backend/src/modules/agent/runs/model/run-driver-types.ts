/** The task owner knows identity, durable admission revision and cancellation lifetime only. */
export interface RunExecutionScope {
	deadlineAt: number;
	userId: number;
	appId: string;
	runId: string;
	version: number;
	requestHash: string;
}

/** Trusted in-process drivers use the original Run identity and cancellation lifetime. */
export interface RunDriverExecution {
	scope: RunExecutionScope;
	signal: AbortSignal;
	onBackgroundFailure(failure: RunFailure, error: unknown): void;
}

export interface RunExecutionHandle {
	cancel(reason?: unknown): void;
	settled: Promise<void>;
}

export interface RunDriver {
	execute(execution: RunDriverExecution): Promise<void>;
}

import type { RunFailure } from './run-types.js';
