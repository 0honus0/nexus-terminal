import type { ToolTarget } from './tool-types.js';
import type { ToolOperation } from '../../runs/model/run-tool-types.js';
import type { ToolJobState } from '../tool-job-values.js';

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
	state: ToolJobState;
	revision: number;
	result: ToolJobResult | null;
	createdAt: number;
	updatedAt: number;
}

export interface ToolJobInput {
	id: string;
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
			exitCode: number;
			signal: string | null;
			stdout: string;
			stderr: string;
			truncated: boolean;
	  };

export interface ToolJobPreparation {
	timeoutMs: number;
	operation: ToolOperation;
	target: ToolTarget;
	policyRevision: number;
	signal: AbortSignal;
	work(signal: AbortSignal, timeoutMs: number): Promise<Exclude<ToolJobResult, { status: 'not_started' }>>;
	validate(signal: AbortSignal): Promise<void>;
}
