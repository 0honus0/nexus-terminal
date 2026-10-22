export const REMOTE_DESKTOP_TICKET_TTL_MS = 30_000;

export const REMOTE_DESKTOP_MAX_PENDING_TICKETS = 1024;

export const REMOTE_DESKTOP_MAX_ACTIVE_SESSIONS = 16;

export const REMOTE_DESKTOP_MIN_DIMENSION = 200;

export const REMOTE_DESKTOP_MAX_DIMENSION = 8192;

export const REMOTE_DESKTOP_MIN_DPI = 48;

export const REMOTE_DESKTOP_MAX_DPI = 480;

export type RemoteDesktopProtocol = 'RDP' | 'VNC';

export const REMOTE_DESKTOP_RESPONSE_MAX_BYTES = 64 * 1024;

export const REMOTE_DESKTOP_FRAME_MAX_BYTES = 2 * 1024 * 1024;

export const REMOTE_DESKTOP_ERROR_CODES = [
	'invalid_input',
	'unauthenticated',
	'forbidden',
	'not_found',
	'conflict',
	'limit_exceeded',
	'remote_unavailable',
	'operation_unknown',
] as const;

export type RemoteDesktopErrorCode = (typeof REMOTE_DESKTOP_ERROR_CODES)[number];
