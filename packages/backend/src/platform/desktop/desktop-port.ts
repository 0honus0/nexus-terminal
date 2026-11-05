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
	certificateFingerprint: string | null;
}

export interface DesktopTransportCertificate {
	fingerprint: string;
	subject: string;
	issuer: string;
	validFrom: number;
	validTo: number;
	systemTrusted: boolean;
	hostMatches: boolean;
}

export interface DesktopTransportPeer {
	open(options: DesktopTransportRequest, onTerminated: () => void): Promise<void>;
}

export interface DesktopTransport {
	probeCertificate(host: string, port: number, signal: AbortSignal): Promise<DesktopTransportCertificate>;
	bind(socket: WebSocket): DesktopTransportPeer;
	close(): Promise<void>;
}
