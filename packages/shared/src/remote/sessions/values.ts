/** Protocol budgets; both encoders and decoders use these exact limits. */
export const REMOTE_FRAME_DATA_BYTES = 32 * 1024;

export const REMOTE_OUTPUT_WINDOW_BYTES = 128 * 1024;

export const REMOTE_TERMINAL_MAX_COLUMNS = 500;

export const REMOTE_TERMINAL_MAX_ROWS = 300;

export const REMOTE_TERMINAL_MAX_TERM_LENGTH = 48;

export type RemoteOperationErrorCode = 'invalid_input' | 'not_found' | 'host_key_untrusted' | 'remote_unavailable';

export type RemoteHttpErrorCode = RemoteOperationErrorCode | 'unauthenticated' | 'forbidden';

export type RemoteWireErrorCode =
	Exclude<RemoteOperationErrorCode, 'host_key_untrusted'> | 'unauthenticated' | 'transport_overflow';
