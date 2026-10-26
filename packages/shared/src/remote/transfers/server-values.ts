export const SERVER_TRANSFER_METHODS = ['auto', 'rsync', 'scp'] as const;

export type ServerTransferMethod = (typeof SERVER_TRANSFER_METHODS)[number];

export type ServerTransferMethodUsed = Exclude<ServerTransferMethod, 'auto'>;

export const SERVER_TRANSFER_TASK_STATES = [
	'queued',
	'in-progress',
	'cancelling',
	'completed',
	'failed',
	'partially-completed',
	'cancelled',
	'unknown',
] as const;

export type ServerTransferTaskStatus = (typeof SERVER_TRANSFER_TASK_STATES)[number];

export const SERVER_TRANSFER_ITEM_STATES = [
	'queued',
	'connecting',
	'transferring',
	'completed',
	'failed',
	'cancelled',
	'unknown',
] as const;

export type ServerTransferItemStatus = (typeof SERVER_TRANSFER_ITEM_STATES)[number];

export const SERVER_TRANSFER_ERROR_CODES = [
	'invalid_input',
	'invalid_body',
	'unauthenticated',
	'forbidden',
	'not_found',
	'resource_active',
	'limit_exceeded',
	'shutting_down',
	'stale_target',
	'unsupported_target_route',
	'unsupported_endpoint',
	'host_key_untrusted',
	'connection_failed',
	'tool_unavailable',
	'transfer_failed',
	'operation_unknown',
	'cleanup_failed',
	'storage_unavailable',
	'internal_failure',
	'cancelled',
	'request_timeout',
	'conflict',
] as const;

export type ServerTransferErrorCode = (typeof SERVER_TRANSFER_ERROR_CODES)[number];

export const SERVER_TRANSFER_MAX_PATH_BYTES = 4096;

export const SERVER_TRANSFER_MAX_NAME_BYTES = 255;

export const SERVER_TRANSFER_REQUEST_MAX_BYTES = 128 * 1024;

export const SERVER_TRANSFER_TASK_MAX_BYTES = 1024 * 1024;

export const SERVER_TRANSFER_PAGE_SIZE = 8;

export const SERVER_TRANSFER_PAGE_MAX_BYTES = 8 * SERVER_TRANSFER_TASK_MAX_BYTES + 1024;

export function serverTransferErrorStatus(code: ServerTransferErrorCode): number {
	switch (code) {
		case 'invalid_input':
		case 'invalid_body':
			return 400;
		case 'unauthenticated':
			return 401;
		case 'forbidden':
			return 403;
		case 'not_found':
			return 404;
		case 'resource_active':
		case 'conflict':
		case 'stale_target':
			return 409;
		case 'limit_exceeded':
			return 413;
		case 'request_timeout':
			return 408;
		case 'unsupported_target_route':
		case 'unsupported_endpoint':
		case 'host_key_untrusted':
		case 'connection_failed':
		case 'tool_unavailable':
		case 'transfer_failed':
		case 'cancelled':
			return 422;
		case 'internal_failure':
			return 500;
		default:
			return 503;
	}
}
