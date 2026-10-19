import type { RemoteDesktopErrorCode } from './values.js';

export interface RemoteDesktopDisplayRequest {
	width?: number;
	height?: number;
	dpi?: number;
}

export interface RemoteDesktopSessionPath {
	id: number;
}

/** Only an opaque one-use bearer. Credentials stay server-side. */
export interface RemoteDesktopSessionResponse {
	ticket: string;
	lastConnectedAt: number;
}

export interface RemoteDesktopFailureResponse {
	code: RemoteDesktopErrorCode;
}
