import type { ToolJobState } from '../tool-job-values.js';

export interface StoredJobScope {
	userId: number;
	appId: string;
	runId: string;
}

export interface StoredToolJob {
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
	resultText: string | null;
	createdAt: number;
	updatedAt: number;
}

export interface StoredJobCreate {
	id: string;
	userId: number;
	appId: string;
	runId: string;
	connectionId: number;
	targetVersion: number;
	fingerprint: string;
	policyRevision: number;
	maxHistory: number;
}

export interface StoredJobChange {
	scope: StoredJobScope;
	id: string;
	expectedRevision: number;
	state: 'dispatched' | 'completed' | 'failed' | 'unknown';
	resultText: string | null;
}

export interface ToolJobStorage {
	create(input: StoredJobCreate): Promise<StoredToolJob | 'version_conflict' | 'limit_exceeded'>;
	get(scope: StoredJobScope, id: string): Promise<StoredToolJob | null>;
	list(scope: StoredJobScope, connectionId: number, limit: number): Promise<StoredToolJob[]>;
	change(input: StoredJobChange): Promise<StoredToolJob | 'version_conflict'>;
	reconcile(): Promise<void>;
}
