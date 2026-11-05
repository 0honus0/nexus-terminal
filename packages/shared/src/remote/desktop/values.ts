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
	'certificate_required',
	'limit_exceeded',
	'remote_unavailable',
	'operation_unknown',
] as const;

export type RemoteDesktopErrorCode = (typeof REMOTE_DESKTOP_ERROR_CODES)[number];

export const RDP_CERTIFICATE_REASONS = ['untrusted', 'expired', 'hostname_mismatch', 'changed'] as const;

export type RdpCertificateReason = (typeof RDP_CERTIFICATE_REASONS)[number];

/** SHA-256 fingerprint as emitted by Node TLS, 32 uppercase octets. */
export function isRdpCertificateFingerprint(value: unknown): value is string {
	return typeof value === 'string' && /^[A-F0-9]{2}(?::[A-F0-9]{2}){31}$/u.test(value);
}
