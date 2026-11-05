import type { RemoteDesktopErrorCode, RemoteDesktopProtocol, RdpCertificateReason } from './values.js';

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

export interface RdpCertificateView {
	connectionId: number;
	host: string;
	port: number;
	fingerprint: string;
	previousFingerprint: string | null;
	subject: string;
	issuer: string;
	validFrom: number;
	validTo: number;
	reason: RdpCertificateReason;
}

export interface RdpCertificateApproval {
	host: string;
	port: number;
	fingerprint: string;
	previousFingerprint: string | null;
	remember: boolean;
}

export interface RemoteDesktopSessionRequest {
	certificate: RdpCertificateApproval | null;
}

export type RemoteDesktopFailureResponse =
	| { code: Exclude<RemoteDesktopErrorCode, 'certificate_required'> }
	| { code: 'certificate_required'; certificate: RdpCertificateView };
