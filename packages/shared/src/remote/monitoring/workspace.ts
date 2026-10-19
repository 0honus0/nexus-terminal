import type { WorkspaceStatusSample, WorkspaceStatusError } from './events.js';

export interface WorkspaceMonitoringRequests {
	'status.start': Record<string, never>;
	'status.stop': Record<string, never>;
}

export interface WorkspaceMonitoringResponses {
	'status.start': null;
	'status.stop': null;
}

export interface WorkspaceMonitoringEvents {
	'status.sample': WorkspaceStatusSample;
	'status.error': WorkspaceStatusError;
}
