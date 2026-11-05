import type { ToolResourceSnapshot } from '../../tools/model/tool-resource-types.js';

export interface RunResourceScope {
	userId: number;
	appId: string;
	runId: string;
}

export interface RunResourceSnapshot {
	resource: ToolResourceSnapshot;
	backgroundJobs: number;
	expiresAt: number | null;
}

export interface CloseRunResources {
	target: { kind: 'app' } | { kind: 'session'; runId: string; sessionId: string };
	confirmed: boolean;
}

export interface CloseRunResourcesResult {
	status: 'closed' | 'confirmation_required';
	activeRuns: number;
	activeOperations: number;
	backgroundJobs: number;
}
