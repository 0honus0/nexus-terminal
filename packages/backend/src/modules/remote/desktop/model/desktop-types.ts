import type {
	RemoteDesktopProtocol,
	RemoteDesktopErrorCode,
	RdpCertificateReason,
} from '@nexus-terminal/shared/remote/desktop/values';

export interface DesktopDisplay {
	width: number | null;
	height: number | null;
	dpi: number | null;
}

export interface DesktopTicketResult {
	ticket: string;
	connection: DesktopConnection;
}

export interface DesktopConnection {
	certificateFingerprint: string | null;
	protocol: RemoteDesktopProtocol;
	host: string;
	port: number;
	username: string | null;
	password: string;
}

export interface DesktopTicket {
	readonly certificateFingerprint: string | null;
	readonly userId: number;
	readonly tokenDigest: string;
	readonly targetId: number;
	readonly targetVersion: number;
	readonly protocol: RemoteDesktopProtocol;
	readonly expiresAt: number;
	readonly display: DesktopDisplay;
}

export interface DesktopCertificate {
	fingerprint: string;
	subject: string;
	issuer: string;
	validFrom: number;
	validTo: number;
	systemTrusted: boolean;
	hostMatches: boolean;
}

export interface DesktopCertificateChallenge {
	targetId: number;
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

export interface DesktopCertificateApproval {
	host: string;
	port: number;
	fingerprint: string;
	previousFingerprint: string | null;
	remember: boolean;
}

/** Instance-bound application capability; raw HTTP/WS handles stay in Model. */
export interface DesktopPeer {
	readonly isOpen: boolean;
	readonly isClosed: boolean;
	onClosed(listener: () => void): void;
	requestClose(reason: RemoteDesktopErrorCode): void;
	disconnect(): void;
	waitClosed(timeoutMs: number): Promise<void>;
	open(connection: DesktopConnection, display: DesktopDisplay, onTerminated: () => void): Promise<void>;
}
