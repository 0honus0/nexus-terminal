import type {
	RemoteDesktopErrorCode,
	RemoteDesktopProtocol,
	RdpCertificateReason,
} from '@nexus-terminal/shared/remote/desktop/values';

export interface RemoteDesktopConnection {
	id: number;
	name: string;
	type: RemoteDesktopProtocol;
}

export interface RemoteDesktopDisplay {
	width: number;
	height: number;
	dpi: number;
}

export interface RemoteDesktopSession {
	ticket: string;
	protocol: RemoteDesktopProtocol;
	host: string;
	port: number;
	username: string;
	password: string;
}

export type RemoteDesktopState = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'error';

export type RemoteTouchMode = 'direct' | 'touchpad';

export type RemoteDesktopFailureCode =
	RemoteDesktopErrorCode | 'protocol_failure' | 'request_failed' | 'cancelled' | 'input_failed' | 'cleanup_failed';

export class RemoteDesktopFailure extends Error {
	constructor(
		readonly code: RemoteDesktopFailureCode,
		readonly outcome: 'not_dispatched' | 'confirmed' | 'unknown',
		options?: ErrorOptions,
	) {
		super('Remote desktop operation failed', options);
		this.name = 'RemoteDesktopFailure';
	}
}

export interface RemoteDesktopCertificate {
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

export interface RemoteDesktopCertificateApproval {
	host: string;
	port: number;
	fingerprint: string;
	previousFingerprint: string | null;
	remember: boolean;
}

export class RemoteDesktopCertificateRequired extends RemoteDesktopFailure {
	constructor(readonly certificate: RemoteDesktopCertificate) {
		super('certificate_required', 'confirmed');
	}
}

export interface RemoteDesktopApi {
	create(
		connectionId: number,
		protocol: RemoteDesktopProtocol,
		display: RemoteDesktopDisplay,
		signal: AbortSignal,
		approval?: RemoteDesktopCertificateApproval | null,
	): Promise<RemoteDesktopSession>;
}

export interface RemoteDesktopPeer {
	readonly element: HTMLElement;
	readonly fileClipboard?: RemoteDesktopFileClipboard;
	connect(session: RemoteDesktopSession, display: RemoteDesktopDisplay): void;
	resize(display: RemoteDesktopDisplay): void;
	focus(): void;
	setTouchMode(mode: RemoteTouchMode): void;
	setTextInputActive(active: boolean): void;
	syncClipboard(): Promise<void>;
	sendText(text: string): void;
	close(): void;
}

export interface RemoteDesktopClipboardFile {
	id: string;
	name: string;
	path: string;
	size: number;
	isDirectory: boolean;
}

export interface RemoteDesktopClipboardProgress {
	transferred: number;
	total: number;
}

export interface RemoteDesktopFileClipboardState {
	files: RemoteDesktopClipboardFile[];
	canUpload: boolean;
	upload: (RemoteDesktopClipboardProgress & { waiting: boolean }) | null;
	downloads: (RemoteDesktopClipboardProgress & { id: string })[];
}

export interface RemoteDesktopFileClipboard {
	subscribe(listener: (state: RemoteDesktopFileClipboardState) => void): () => void;
	upload(files: File[]): Promise<void>;
	download(id: string): Promise<Blob>;
}

export interface RemoteDesktopPeerOptions {
	hasTouch: boolean;
	touchMode: RemoteTouchMode;
	mobileInput: HTMLTextAreaElement | null;
	onState(state: RemoteDesktopState): void;
	onFailure(failure: RemoteDesktopFailure): void;
}

export type RemoteDesktopPeerFactory = (options: RemoteDesktopPeerOptions) => RemoteDesktopPeer;
