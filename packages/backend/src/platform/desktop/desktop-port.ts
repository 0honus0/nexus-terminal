import type { IncomingMessage } from 'node:http';
import type WebSocket from 'ws';

export class DesktopTransportFailure extends Error {
	constructor(
		readonly reason: 'unavailable' | 'cleanup_failed',
		options?: ErrorOptions,
	) {
		super('Desktop transport failed', options);
	}
}

/** Technology-only parameter set: no Target, ticket, identity or Service types. */
export interface DesktopTransportRequest {
	protocol: 'rdp' | 'vnc';
	host: string;
	port: number;
	username: string | null;
	password: string;
	width: number;
	height: number;
	dpi: number;
	security: 'any';
	ignoreCertificate: boolean;
	resizeMethod: 'display-update';
	remoteApp: string | null;
	remoteAppDirectory: string | null;
	remoteAppArguments: string | null;
}

export interface DesktopTransport {
	/** Resolves at guacd 'ready', not when the connection task is dispatched.
	 * onTerminated is emitted only after the Guacamole close owner runs
	 * and its underlying guacd TCP socket closure is confirmed. */
	open(
		socket: WebSocket,
		request: IncomingMessage,
		options: DesktopTransportRequest,
		onTerminated: () => void,
	): Promise<void>;
	close(): Promise<void>;
}
