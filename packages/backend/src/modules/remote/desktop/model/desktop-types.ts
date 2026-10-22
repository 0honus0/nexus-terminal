import type { RemoteDesktopProtocol, RemoteDesktopErrorCode } from '@nexus-terminal/shared/remote/desktop/values';

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
	protocol: RemoteDesktopProtocol;
	host: string;
	port: number;
	username: string | null;
	password: string;
}

export interface DesktopTicket {
	readonly userId: number;
	readonly tokenDigest: string;
	readonly targetId: number;
	readonly targetVersion: number;
	readonly protocol: RemoteDesktopProtocol;
	readonly expiresAt: number;
	readonly display: DesktopDisplay;
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
