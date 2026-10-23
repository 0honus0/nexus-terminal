export const HOST_DIAGNOSTIC_MAX_RESPONSE_BYTES = 16 * 1024;

export const HOST_DIAGNOSTIC_ERROR_CODES = ['invalid_input', 'unauthenticated', 'forbidden', 'unavailable'] as const;

export type HostDiagnosticErrorCode = (typeof HOST_DIAGNOSTIC_ERROR_CODES)[number];

export const DIAGNOSTIC_MODULE_IDS = [
	'access',
	'agent',
	'operations',
	'preferences',
	'remote',
	'system',
	'targets',
	'storage',
] as const;

export type DiagnosticModuleId = (typeof DIAGNOSTIC_MODULE_IDS)[number];

export const DIAGNOSTIC_RESOURCE_UNITS = {
	active_http_requests: 'count',
	active_workspaces: 'count',
	suspended_sessions: 'count',
	disconnected_sessions: 'count',
	output_buffer_bytes: 'bytes',
	input_buffer_bytes: 'bytes',
	suspend_queue_bytes: 'bytes',
	resume_buffer_bytes: 'bytes',
	active_transfers: 'count',
	retained_transfers: 'count',
	pending_requests: 'count',
	pending_operations: 'count',
	worker_heap_used_bytes: 'bytes',
	worker_heap_total_bytes: 'bytes',
	worker_external_bytes: 'bytes',
	worker_array_buffer_bytes: 'bytes',
	active_runs: 'count',
	pending_run_writes: 'count',
	status_subscriptions: 'count',
} as const;

export type DiagnosticResourceName = keyof typeof DIAGNOSTIC_RESOURCE_UNITS;

export type DiagnosticResourceUnit = (typeof DIAGNOSTIC_RESOURCE_UNITS)[DiagnosticResourceName];

export const DIAGNOSTIC_RESOURCE_STATUSES = ['available', 'unavailable', 'not_instrumented'] as const;

export type DiagnosticResourceStatus = (typeof DIAGNOSTIC_RESOURCE_STATUSES)[number];
