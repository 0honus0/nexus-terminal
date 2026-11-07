import type { ToolTarget } from './tool-types.js';
import type { HostEffect } from './host-execution-types.js';
import type { AgentToolJobState } from '@nexus-terminal/shared/agent/tools/values';

export interface ToolJobScope {
	userId: number;
	appId: string;
	runId: string;
}

export interface ToolJob {
	id: string;
	userId: number;
	appId: string;
	runId: string;
	connectionId: number;
	targetVersion: number;
	fingerprint: string;
	policyRevision: number;
	state: AgentToolJobState;
	revision: number;
	result: ToolJobResult | null;
	createdAt: number;
	updatedAt: number;
}

export interface ToolJobInput {
	id: string;
	operationHash: string;
	userId: number;
	appId: string;
	runId: string;
	connectionId: number;
	targetVersion: number;
	fingerprint: string;
	policyRevision: number;
}

export type ToolJobResult =
	| { status: 'not_started' }
	| {
			status: 'completed' | 'nonzero';
			commands: Array<
				| { index: number; status: 'not_started' }
				| {
						index: number;
						status: 'completed' | 'nonzero';
						exitCode: number;
						signal: string | null;
						stdout: string;
						stderr: string;
						truncated: boolean;
				  }
			>;
	  };

export interface ToolJobAccepted {
	jobId: string;
	accepted: true;
}

export interface ToolJobSummary {
	jobId: string;
	state: AgentToolJobState;
	revision: number;
	waitingForSpace: boolean;
	createdAt: number;
	updatedAt: number;
}

export interface ToolJobSnapshot extends ToolJobSummary {
	result: ToolJobResult | null;
}

export interface ToolJobOutputValue {
	jobId: string;
	state: AgentToolJobState;
	offset: number;
	nextOffset: number;
	capturedBytes: number;
	available: boolean;
	waitingForSpace: boolean;
	output: ToolOutputEvent[];
	complete: boolean;
}

export type ToolJobControlValue =
	| { jobs: ToolJobSummary[]; nextOffset: number | null }
	| { jobs: ToolJobOutputValue[]; nextIndex: number | null }
	| { jobs: ToolJobSnapshot[] };

export type ToolJobValue = ToolJobAccepted | ToolJobSnapshot | ToolJobControlValue;

export interface ToolJobPreparation {
	background: boolean;
	deadlineAt: number;
	maxHistory: number;
	operation: HostEffect;
	target: ToolTarget;
	policyRevision: number;
	signal: AbortSignal;
	work(
		signal: AbortSignal,
		timeoutMs: number,
		onOutput: (index: number, stream: 'stdout' | 'stderr', text: string, signal: AbortSignal) => Promise<void>,
	): Promise<Exclude<ToolJobResult, { status: 'not_started' }>>;
	validate(signal: AbortSignal): Promise<void>;
	onFailure(error: unknown): void;
}

export interface ToolOutputEvent {
	commandIndex: number;
	stream: 'stdout' | 'stderr';
	text: string;
}

export interface ToolOutputPage {
	output: ToolOutputEvent[];
	nextOffset: number;
	capturedBytes: number;
}

export interface ToolOutputWriter {
	append(event: ToolOutputEvent, signal: AbortSignal, blocked: (waiting: boolean) => void): Promise<void>;
	flush(signal: AbortSignal, blocked: (waiting: boolean) => void): Promise<void>;
	close(): Promise<void>;
}
