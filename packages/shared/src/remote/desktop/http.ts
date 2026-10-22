import type { RemoteDesktopErrorCode, RemoteDesktopProtocol } from './values.js';

export interface RemoteDesktopDisplayRequest {
	width?: number;
	height?: number;
	dpi?: number;
}

export interface RemoteDesktopSessionPath {
	id: number;
}

export interface RemoteDesktopSessionResponse {
	ticket: string;
	protocol: RemoteDesktopProtocol;
	host: string;
	port: number;
	username: string;
	password: string;
}

export interface RemoteDesktopFailureResponse {
	code: RemoteDesktopErrorCode;
}
