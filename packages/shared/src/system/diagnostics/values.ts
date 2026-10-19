export const HOST_DIAGNOSTIC_MAX_RESPONSE_BYTES = 16 * 1024;

export const HOST_DIAGNOSTIC_ERROR_CODES = ['invalid_input', 'unauthenticated', 'forbidden', 'unavailable'] as const;

export type HostDiagnosticErrorCode = (typeof HOST_DIAGNOSTIC_ERROR_CODES)[number];
